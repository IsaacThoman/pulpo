import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '../config.js'
import { db, queryClient } from '../database/client.js'
import { applicationSettings, fileNodes, fileRecordingClips, users } from '../database/schema.js'
import { encryptSecret } from '../lib/crypto.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
const queued = vi.hoisted(() => [] as string[])
const groq = vi.hoisted(() => vi.fn())
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn() }))
vi.mock('../jobs.js', () => ({
  fileDocQueue: { add: vi.fn() },
  fileRecordingQueue: { add: async (_name: string, job: { clipId: string }) => { queued.push(job.clipId) } },
}))
vi.mock('../dictation/groq.js', async (original) => ({ ...await original<typeof import('../dictation/groq.js')>(), transcribeWithGroq: groq }))
vi.mock('../storage/index.js', () => ({
  getBlobStore: () => ({
    put: async (key: string, body: Uint8Array) => { objects.set(key, Buffer.from(body)) },
    get: async (key: string) => objects.get(key) ?? Buffer.alloc(0),
    delete: async (key: string) => { objects.delete(key) },
    copy: async (source: string, target: string) => { objects.set(target, objects.get(source)!) },
    createDownloadUrl: async (key: string) => `/api/files/local-download/${encodeURIComponent(key)}`,
  }),
}))

const { addRecordingClip, createRecording, deleteRecordingClip, getRecording, retryRecordingTranscript, transcribeRecordingClip, updateRecordingSkips } = await import('./recordings.js')
const { copyFileNodes } = await import('./copy-service.js')
const { deleteFileNode, trashFileNode } = await import('./tree-service.js')
const { catCommand } = await import('./agent/read-commands.js')
const { loadFileScope } = await import('./agent/scope.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string

/** A short WebM/Opus take, as Chrome's recorder makes. */
function webmTake(seconds: number): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'libopus', '-f', 'webm', 'pipe:1'])
}

async function setDictation(enabledValue: boolean) {
  await db.delete(applicationSettings).where(eq(applicationSettings.key, 'dictation'))
  await db.insert(applicationSettings).values({
    key: 'dictation',
    value: { enabled: enabledValue, billUsers: false, pricePerMinuteMicros: 0, encryptedGroqApiKey: encryptSecret('groq-key', getConfig().ENCRYPTION_KEY) },
  })
}

describe.skipIf(!enabled)('voice recordings against PostgreSQL', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Recording test', email: `${userId}@example.test`, username: `r${userId.replaceAll('-', '')}`, role: 'user', storageLimitBytes: 10_000_000 })
    objects.clear()
    queued.length = 0
    groq.mockReset()
    await setDictation(true)
  })
  afterAll(async () => {
    await db.delete(applicationSettings).where(eq(applicationSettings.key, 'dictation'))
    await queryClient.end()
  })

  it('appends takes as playable MP4, counts them toward storage, and queues transcripts', async () => {
    const recording = await createRecording(userId, { parentId: null })
    expect(recording).toMatchObject({ kind: 'recording', name: 'Untitled recording', sizeBytes: 0 })
    expect((await createRecording(userId, { parentId: null })).name).toBe('Untitled recording (2)')

    const first = await addRecordingClip(userId, recording.id, { audio: webmTake(1.5), metadata: { durationMs: 9_999, levels: [10, 50, 90] } })
    const second = await addRecordingClip(userId, recording.id, { audio: webmTake(1), metadata: { durationMs: 1_000, levels: [] } })
    // The take is re-encoded and measured; the recorder's own length is not trusted.
    expect(first).toMatchObject({ position: 0, mimeType: 'audio/mp4', levels: [10, 50, 90], transcript: { status: 'pending' } })
    expect(Math.abs(first.durationMs - 1_500)).toBeLessThan(100)
    expect(second.position).toBe(1)
    expect(queued).toEqual([first.id, second.id])
    const stored = objects.get(`users/${userId}/files/${recording.id}/takes/${first.id}`)!
    expect(stored.subarray(4, 8).toString()).toBe('ftyp')

    const loaded = await getRecording(userId, recording.id)
    expect(loaded.clips.map((clip) => clip.id)).toEqual([first.id, second.id])
    expect(loaded.node.sizeBytes).toBe(first.sizeBytes + second.sizeBytes)
  })

  it('rejects audio it cannot read and takes for recordings in the trash', async () => {
    const recording = await createRecording(userId, { parentId: null })
    await expect(addRecordingClip(userId, recording.id, { audio: Buffer.from('#EXTM3U\nfile:///etc/passwd\n'), metadata: { durationMs: 1_000, levels: [] } }))
      .rejects.toMatchObject({ code: 'recording_audio_type_unsupported' })
    await expect(addRecordingClip(userId, recording.id, { audio: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]), metadata: { durationMs: 1_000, levels: [] } }))
      .rejects.toMatchObject({ code: 'recording_audio_invalid' })
    expect(objects.size).toBe(0)
    await trashFileNode(userId, recording.id)
    await expect(addRecordingClip(userId, recording.id, { audio: webmTake(0.5), metadata: { durationMs: 500, levels: [] } }))
      .rejects.toMatchObject({ code: 'file_trashed' })
  })

  it('stores timed transcripts from the worker and lets failed ones be retried', async () => {
    const recording = await createRecording(userId, { parentId: null })
    const take = await addRecordingClip(userId, recording.id, { audio: webmTake(1), metadata: { durationMs: 1_000, levels: [] } })
    groq.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 429 }))
    await expect(transcribeRecordingClip(take.id, { finalAttempt: false })).rejects.toThrow('busy')
    expect((await getRecording(userId, recording.id)).clips[0]!.transcript.status).toBe('pending')

    groq.mockRejectedValueOnce(new Error('network down'))
    await transcribeRecordingClip(take.id, { finalAttempt: true })
    expect((await getRecording(userId, recording.id)).clips[0]!.transcript).toEqual({ status: 'failed', segments: [], error: 'The transcript could not be made.' })

    await retryRecordingTranscript(userId, recording.id, take.id)
    expect(queued).toEqual([take.id, take.id])
    groq.mockResolvedValueOnce({ text: 'Hello. Bye.', durationSeconds: 1, segments: [{ start: 0, end: 0.4, text: 'Hello.' }, { start: 0.5, end: 1, text: 'Bye.' }] })
    await transcribeRecordingClip(take.id, { finalAttempt: false })
    expect((await getRecording(userId, recording.id)).clips[0]!.transcript).toEqual({
      status: 'ready', error: null, segments: [{ startMs: 0, endMs: 400, text: 'Hello.' }, { startMs: 500, endMs: 1_000, text: 'Bye.' }],
    })
    await expect(retryRecordingTranscript(userId, recording.id, take.id)).rejects.toMatchObject({ code: 'recording_transcript_busy' })
  })

  it('marks takes recorded while transcription is off', async () => {
    await setDictation(false)
    const recording = await createRecording(userId, { parentId: null })
    const take = await addRecordingClip(userId, recording.id, { audio: webmTake(0.5), metadata: { durationMs: 500, levels: [] } })
    expect(take.transcript.status).toBe('unavailable')
    expect(queued).toEqual([])
    await expect(retryRecordingTranscript(userId, recording.id, take.id)).rejects.toMatchObject({ code: 'dictation_disabled' })
  })

  it('replaces skips per take, ignoring ones for takes that are gone', async () => {
    const recording = await createRecording(userId, { parentId: null })
    const take = await addRecordingClip(userId, recording.id, { audio: webmTake(2), metadata: { durationMs: 2_000, levels: [] } })
    const updated = await updateRecordingSkips(userId, recording.id, [
      { clipId: take.id, startMs: 1_500, endMs: 60_000 },
      { clipId: take.id, startMs: 100, endMs: 200 },
      { clipId: take.id, startMs: 0, endMs: 600 },
      { clipId: randomUUID(), startMs: 0, endMs: 1_000 },
    ])
    expect(updated.clips[0]!.skips).toEqual([{ startMs: 0, endMs: 600 }, { startMs: 1_500, endMs: updated.clips[0]!.durationMs }])
    expect((await updateRecordingSkips(userId, recording.id, [])).clips[0]!.skips).toEqual([])
  })

  it('removes a take with its audio and storage', async () => {
    const recording = await createRecording(userId, { parentId: null })
    const first = await addRecordingClip(userId, recording.id, { audio: webmTake(0.5), metadata: { durationMs: 500, levels: [] } })
    const second = await addRecordingClip(userId, recording.id, { audio: webmTake(0.5), metadata: { durationMs: 500, levels: [] } })
    const after = await deleteRecordingClip(userId, recording.id, first.id)
    expect(after.clips.map((clip) => clip.id)).toEqual([second.id])
    expect(after.node.sizeBytes).toBe(second.sizeBytes)
    expect(objects.has(`users/${userId}/files/${recording.id}/takes/${first.id}`)).toBe(false)
    // A new take still goes at the end.
    const third = await addRecordingClip(userId, recording.id, { audio: webmTake(0.5), metadata: { durationMs: 500, levels: [] } })
    expect(third.position).toBe(2)
  })

  it('copies takes with their own audio, and deletes it with the recording', async () => {
    const recording = await createRecording(userId, { parentId: null, name: 'Standup' })
    const take = await addRecordingClip(userId, recording.id, { audio: webmTake(0.5), metadata: { durationMs: 500, levels: [5] } })
    await updateRecordingSkips(userId, recording.id, [{ clipId: take.id, startMs: 0, endMs: 300 }])
    const [copy] = await copyFileNodes(userId, [recording.id], null)
    expect(copy).toMatchObject({ kind: 'recording', name: 'Standup (2)', status: 'ready', sizeBytes: take.sizeBytes })
    const copied = await getRecording(userId, copy!.id)
    expect(copied.clips).toHaveLength(1)
    expect(copied.clips[0]).toMatchObject({ levels: [5], skips: [{ startMs: 0, endMs: 300 }], transcript: { status: 'failed' } })
    expect(copied.clips[0]!.id).not.toBe(take.id)
    const copyKey = `users/${userId}/files/${copy!.id}/takes/${copied.clips[0]!.id}`
    expect(objects.get(copyKey)).toEqual(objects.get(`users/${userId}/files/${recording.id}/takes/${take.id}`))

    await trashFileNode(userId, copy!.id)
    await deleteFileNode(userId, copy!.id)
    expect(objects.has(copyKey)).toBe(false)
    expect(await db.select().from(fileRecordingClips).where(eq(fileRecordingClips.nodeId, copy!.id))).toEqual([])
    expect(await db.select().from(fileNodes).where(inArray(fileNodes.id, [copy!.id]))).toEqual([])
  })

  it('gives agents the transcript without the skipped parts', async () => {
    const recording = await createRecording(userId, { parentId: null, name: 'Notes' })
    const take = await addRecordingClip(userId, recording.id, { audio: webmTake(2), metadata: { durationMs: 2_000, levels: [] } })
    groq.mockResolvedValueOnce({ text: 'Keep. Drop.', durationSeconds: 2, segments: [{ start: 0, end: 1, text: 'Keep this.' }, { start: 1, end: 2, text: 'Drop this.' }] })
    await transcribeRecordingClip(take.id, { finalAttempt: true })
    await updateRecordingSkips(userId, recording.id, [{ clipId: take.id, startMs: 1_000, endMs: 2_000 }])
    const scope = await loadFileScope(userId, [recording.id], { [recording.id]: 'read' })
    const { output } = await catCommand({ userId, chatId: randomUUID(), scope } as never, { path: 'Notes' })
    expect(output).toContain('[0:00] Keep this.')
    expect(output).toContain('[Skipped from 0:01]')
    expect(output).not.toContain('Drop this.')
  })
})
