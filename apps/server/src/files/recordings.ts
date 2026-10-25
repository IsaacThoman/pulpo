import { createHash } from 'node:crypto'
import { and, asc, eq, max, sql } from 'drizzle-orm'
import { normalizeClipSkips } from '@pulpo/client-core/files'
import {
  RECORDING_MAX_CLIPS,
  type FileNode,
  type FileRecording,
  type RecordingClip,
  type RecordingClipMetadata,
  type RecordingSkipUpdate,
  type RecordingTranscriptStatus,
} from '@pulpo/contracts'
import { chargeMeteredUsage } from '../accounting/service.js'
import { assertDailySpendAvailable } from '../billing/usage-tiers.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings, fileNodes, fileRecordingClips, users } from '../database/schema.js'
import { dictationUsageMicros } from '../dictation/billing.js'
import { GroqTranscriptionError, transcribeWithGroq } from '../dictation/groq.js'
import { bumpAccountRevisions, publishScopedStateChanges } from '../friends/sync.js'
import { fileRecordingQueue } from '../jobs.js'
import { decryptSecret } from '../lib/crypto.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { diagnosticFetch } from '../logging/diagnostic-fetch.js'
import { parseDictationSettings } from '../settings/application-settings.js'
import { getBlobStore } from '../storage/index.js'
import { resolveFileAccess, type FileExecutor, type FileNodeRow } from './access.js'
import { normalizeRecordingAudio } from './recording-audio.js'
import { toFileNodes } from './shortcuts.js'
import { assertDestination, availableName, mutateFileTree, toFileNode } from './tree-service.js'
import { topSortOrder } from './order.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ClipRow = typeof fileRecordingClips.$inferSelect

export const DEFAULT_RECORDING_NAME = 'Untitled recording'
export const RECORDING_COPIED_PENDING = 'This take was copied before its transcript was ready.'
/** A transcript still pending after this long was lost (e.g. the worker restarted) and can be retried. */
export const RECORDING_TRANSCRIPT_STALE_MS = 15 * 60_000
const TRANSCRIPTION_TIMEOUT_MS = 3 * 60_000
const GROQ_MODEL = 'whisper-large-v3-turbo'

/** Where a take's audio is stored. Under the owner's files prefix, so local downloads route to Files. */
export function recordingClipKey(userId: string, nodeId: string, clipId: string): string {
  return `users/${userId}/files/${nodeId}/takes/${clipId}`
}

/** The audio container from its first bytes; clients' declared types are not trusted. */
export function sniffRecordingMimeType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (bytes.length < 12) return null
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm'
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4'
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav'
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return 'audio/mpeg'
  return null
}

const RECORDING_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3',
}

export function recordingClipExtension(mimeType: string): string {
  return RECORDING_EXTENSIONS[mimeType] ?? 'audio'
}

function transcriptStatusOf(row: ClipRow, now: number): { status: RecordingTranscriptStatus; error: string | null } {
  if (row.transcriptStatus === 'pending' && now - row.updatedAt.getTime() > RECORDING_TRANSCRIPT_STALE_MS) {
    return { status: 'failed', error: 'Transcribing this take took too long.' }
  }
  return { status: row.transcriptStatus as RecordingTranscriptStatus, error: row.transcriptError }
}

export function toRecordingClip(row: ClipRow, now = Date.now()): RecordingClip {
  const { status, error } = transcriptStatusOf(row, now)
  return {
    id: row.id,
    position: row.position,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    levels: row.levels,
    skips: row.skips,
    transcript: { status, segments: status === 'ready' ? row.transcript : [], error: status === 'failed' ? error : null },
    recordedAt: row.recordedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

export async function recordingClipRows(executor: FileExecutor, nodeId: string): Promise<ClipRow[]> {
  return executor.select().from(fileRecordingClips).where(eq(fileRecordingClips.nodeId, nodeId)).orderBy(asc(fileRecordingClips.position))
}

const notRecording = () => notFound('Recording')
const recordingTrashed = () => new AppError(409, 'file_trashed', 'Restore this recording from the trash to change it')

/** A recording the user can change: theirs, a recording, and not in the trash. */
async function editableRecording(executor: FileExecutor, userId: string, nodeId: string): Promise<FileNodeRow> {
  const access = await resolveFileAccess(executor, userId, nodeId)
  if (!access || access.node.kind !== 'recording' || access.node.status !== 'ready') throw notRecording()
  if (access.node.trashedAt) throw recordingTrashed()
  return access.node
}

async function lockRecording(tx: DatabaseTransaction, nodeId: string): Promise<void> {
  // Serializes takes being added to, removed from, or reordered in one recording.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pulpo-recording:${nodeId}`}))`)
}

export async function createRecording(userId: string, input: { parentId: string | null; name?: string }): Promise<FileNode> {
  return mutateFileTree(userId, async (tx) => {
    await assertDestination(tx, userId, input.parentId)
    const name = await availableName(tx, userId, input.parentId, input.name ?? DEFAULT_RECORDING_NAME)
    const [node] = await tx.insert(fileNodes).values({
      id: newId(), ownerUserId: userId, parentId: input.parentId, kind: 'recording', name,
      sortOrder: await topSortOrder(tx, userId, input.parentId),
    }).returning()
    return toFileNode(node!)
  })
}

export async function getRecording(userId: string, nodeId: string): Promise<FileRecording> {
  const access = await resolveFileAccess(db, userId, nodeId)
  if (!access || access.node.kind !== 'recording' || access.node.status !== 'ready') throw notRecording()
  const [node] = await toFileNodes(db, userId, [access.node])
  const now = Date.now()
  return { node: node!, clips: (await recordingClipRows(db, nodeId)).map((row) => toRecordingClip(row, now)) }
}

interface DictationProvider {
  apiKey: string
  billUsers: boolean
  pricePerMinuteMicros: number
}

/** The transcription provider dictation uses, or null while dictation is off. */
async function dictationProvider(): Promise<DictationProvider | null> {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'dictation')).limit(1)
  const settings = parseDictationSettings(row?.value)
  if (!settings.enabled || !settings.encryptedGroqApiKey) return null
  return {
    apiKey: decryptSecret(settings.encryptedGroqApiKey, getConfig().ENCRYPTION_KEY),
    billUsers: settings.billUsers,
    pricePerMinuteMicros: settings.pricePerMinuteMicros,
  }
}

async function queueTranscription(clipId: string): Promise<void> {
  try {
    await fileRecordingQueue.add('transcribe', { clipId }, { jobId: `transcribe-${clipId}-${Date.now()}` })
  } catch {
    await db.update(fileRecordingClips).set({ transcriptStatus: 'failed', transcriptError: 'Transcription could not be started.', updatedAt: new Date() })
      .where(and(eq(fileRecordingClips.id, clipId), eq(fileRecordingClips.transcriptStatus, 'pending')))
  }
}

/**
 * Stores a take's audio and appends it to the recording, then queues its transcript. The audio is
 * converted to a format every client plays, and written before its row, so a stored row always
 * has its object; a rejected take's object is removed.
 */
export async function addRecordingClip(userId: string, nodeId: string, input: {
  audio: Uint8Array
  metadata: RecordingClipMetadata & { levels: number[] }
}): Promise<RecordingClip> {
  await editableRecording(db, userId, nodeId)
  const uploadedType = sniffRecordingMimeType(input.audio)
  if (!uploadedType) throw new AppError(415, 'recording_audio_type_unsupported', 'This audio format is not supported')
  const normalized = await normalizeRecordingAudio(input.audio)
  const audio = normalized?.audio ?? input.audio
  const mimeType = normalized?.mimeType ?? uploadedType
  const durationMs = normalized?.durationMs ?? input.metadata.durationMs
  const id = newId()
  const objectKey = recordingClipKey(userId, nodeId, id)
  const sizeBytes = audio.byteLength
  const transcribing = Boolean(await dictationProvider())
  await getBlobStore().put(objectKey, audio, { contentType: mimeType, contentLength: sizeBytes })
  let row: ClipRow
  try {
    row = await mutateFileTree(userId, async (tx) => {
      const [owner] = await tx.select({ deleting: users.deletionRequestedAt }).from(users).where(eq(users.id, userId)).for('share')
      if (!owner || owner.deleting) throw new AppError(403, 'account_deleting', 'Account deletion has started')
      await editableRecording(tx, userId, nodeId)
      await lockRecording(tx, nodeId)
      const [last] = await tx.select({ position: max(fileRecordingClips.position), count: sql<number>`count(*)::int` })
        .from(fileRecordingClips).where(eq(fileRecordingClips.nodeId, nodeId))
      if ((last?.count ?? 0) >= RECORDING_MAX_CLIPS) {
        throw new AppError(409, 'recording_too_many_takes', `A recording can hold at most ${RECORDING_MAX_CLIPS} takes`)
      }
      const [created] = await tx.insert(fileRecordingClips).values({
        id, nodeId, userId, position: (last?.position ?? -1) + 1, objectKey, mimeType, sizeBytes,
        checksum: createHash('sha256').update(audio).digest('hex'),
        durationMs,
        levels: input.metadata.levels,
        transcriptStatus: transcribing ? 'pending' : 'unavailable',
        recordedAt: input.metadata.recordedAt ? new Date(input.metadata.recordedAt) : new Date(Date.now() - durationMs),
      }).returning()
      await tx.update(fileNodes).set({ sizeBytes: sql`${fileNodes.sizeBytes} + ${sizeBytes}`, updatedAt: new Date() })
        .where(eq(fileNodes.id, nodeId))
      return created!
    }, ['files'], { reserveBytes: sizeBytes })
  } catch (error) {
    await getBlobStore().delete(objectKey).catch(() => undefined)
    throw error
  }
  if (transcribing) await queueTranscription(id)
  const [current] = await db.select().from(fileRecordingClips).where(eq(fileRecordingClips.id, id))
  return toRecordingClip(current ?? row)
}

/** Replaces the recording's skipped parts. Skips of takes no longer in it are ignored. */
export async function updateRecordingSkips(userId: string, nodeId: string, skips: RecordingSkipUpdate[]): Promise<FileRecording> {
  await mutateFileTree(userId, async (tx) => {
    await editableRecording(tx, userId, nodeId)
    await lockRecording(tx, nodeId)
    for (const row of await recordingClipRows(tx, nodeId)) {
      const next = normalizeClipSkips(skips.filter((skip) => skip.clipId === row.id), row.durationMs)
      if (JSON.stringify(next) === JSON.stringify(row.skips)) continue
      await tx.update(fileRecordingClips).set({ skips: next }).where(eq(fileRecordingClips.id, row.id))
    }
  }, ['files'])
  return getRecording(userId, nodeId)
}

/** Removes a take and its audio; the takes around it then play one after the other. */
export async function deleteRecordingClip(userId: string, nodeId: string, clipId: string): Promise<FileRecording> {
  const objectKey = await mutateFileTree(userId, async (tx) => {
    await editableRecording(tx, userId, nodeId)
    await lockRecording(tx, nodeId)
    const [deleted] = await tx.delete(fileRecordingClips)
      .where(and(eq(fileRecordingClips.id, clipId), eq(fileRecordingClips.nodeId, nodeId))).returning()
    if (!deleted) throw notFound('Take')
    await tx.update(fileNodes).set({ sizeBytes: sql`greatest(0, ${fileNodes.sizeBytes} - ${deleted.sizeBytes})`, updatedAt: new Date() })
      .where(eq(fileNodes.id, nodeId))
    return deleted.objectKey
  }, ['files'])
  // The row goes first: a failed object delete leaves an orphan, never a take without audio.
  await getBlobStore().delete(objectKey).catch(() => undefined)
  return getRecording(userId, nodeId)
}

/** Queues a take's transcript again after it failed, was lost, or was made while transcription was off. */
export async function retryRecordingTranscript(userId: string, nodeId: string, clipId: string): Promise<RecordingClip> {
  if (!await dictationProvider()) throw new AppError(409, 'dictation_disabled', 'Transcription is turned off by the administrator')
  const now = Date.now()
  await mutateFileTree(userId, async (tx) => {
    await editableRecording(tx, userId, nodeId)
    const [row] = await tx.select().from(fileRecordingClips)
      .where(and(eq(fileRecordingClips.id, clipId), eq(fileRecordingClips.nodeId, nodeId))).for('update')
    if (!row) throw notFound('Take')
    const { status } = transcriptStatusOf(row, now)
    if (status === 'pending' || status === 'ready') throw new AppError(409, 'recording_transcript_busy', 'This take already has a transcript')
    await tx.update(fileRecordingClips).set({ transcriptStatus: 'pending', transcriptError: null, transcript: [], updatedAt: new Date() })
      .where(eq(fileRecordingClips.id, clipId))
  }, ['files'])
  await queueTranscription(clipId)
  const [current] = await db.select().from(fileRecordingClips).where(eq(fileRecordingClips.id, clipId))
  if (!current) throw notFound('Take')
  return toRecordingClip(current)
}

/** A short-lived URL for a take's audio. */
export async function recordingClipDownload(userId: string, nodeId: string, clipId: string): Promise<{ url: string; name: string; mimeType: string }> {
  const access = await resolveFileAccess(db, userId, nodeId)
  if (!access || access.node.kind !== 'recording' || access.node.status !== 'ready') throw notRecording()
  const rows = await recordingClipRows(db, nodeId)
  const index = rows.findIndex((row) => row.id === clipId)
  if (index < 0) throw notFound('Take')
  const row = rows[index]!
  const name = `${access.node.name}${rows.length > 1 ? ` (take ${index + 1})` : ''}.${recordingClipExtension(row.mimeType)}`
  const url = await getBlobStore().createDownloadUrl(row.objectKey, 300, {
    contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
  })
  return { url, name, mimeType: row.mimeType }
}

/** The take stored at `objectKey`, if it belongs to the user (for the local storage driver's downloads). */
export async function ownedRecordingClipByKey(userId: string, objectKey: string): Promise<ClipRow | null> {
  const [row] = await db.select().from(fileRecordingClips)
    .where(and(eq(fileRecordingClips.objectKey, objectKey), eq(fileRecordingClips.userId, userId))).limit(1)
  return row ?? null
}

async function publishFilesChange(userId: string): Promise<void> {
  const changes = await db.transaction((tx) => bumpAccountRevisions(tx, [userId]))
  await publishScopedStateChanges(changes, ['files'])
}

async function settleTranscript(clipId: string, values: Partial<typeof fileRecordingClips.$inferInsert>): Promise<ClipRow | null> {
  const [row] = await db.update(fileRecordingClips).set({ ...values, updatedAt: new Date() })
    .where(and(eq(fileRecordingClips.id, clipId), eq(fileRecordingClips.transcriptStatus, 'pending'))).returning()
  return row ?? null
}

function retryable(error: unknown): boolean {
  if (error instanceof GroqTranscriptionError) return error.status === 429 || error.status >= 500
  // Timeouts and network failures.
  return !(error instanceof AppError)
}

/**
 * Worker: transcribes one take with the dictation provider and stores timed segments. Errors worth
 * retrying are rethrown for the queue until the final attempt, which records the failure.
 */
export async function transcribeRecordingClip(clipId: string, options: { finalAttempt: boolean }): Promise<void> {
  const [row] = await db.select().from(fileRecordingClips).where(eq(fileRecordingClips.id, clipId))
  if (!row || row.transcriptStatus !== 'pending') return
  const provider = await dictationProvider()
  if (!provider) {
    if (await settleTranscript(clipId, { transcriptStatus: 'unavailable', transcriptError: null })) await publishFilesChange(row.userId)
    return
  }
  try {
    if (provider.billUsers) await assertDailySpendAvailable(row.userId)
    const audio = await getBlobStore().get(row.objectKey)
    const transcript = await transcribeWithGroq({
      apiKey: provider.apiKey,
      audio,
      filename: `take.${recordingClipExtension(row.mimeType)}`,
      mimeType: row.mimeType,
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
      fetchImpl: diagnosticFetch({ purpose: 'dictation', userId: row.userId, providerId: 'groq', upstreamModelId: GROQ_MODEL }),
    })
    const segments = transcript.segments
      .map((segment) => ({ startMs: Math.round(segment.start * 1000), endMs: Math.round(segment.end * 1000), text: segment.text }))
      .filter((segment) => segment.text)
    const settled = await settleTranscript(clipId, { transcriptStatus: 'ready', transcriptError: null, transcript: segments })
    if (!settled) return
    if (provider.billUsers) {
      const usage = dictationUsageMicros(transcript.durationSeconds, provider.pricePerMinuteMicros)
      await chargeMeteredUsage({
        userId: row.userId,
        costMicros: usage.costMicros,
        type: 'dictation',
        metadata: {
          provider: 'groq', model: GROQ_MODEL, source: 'recording', fileId: row.nodeId,
          durationSeconds: transcript.durationSeconds, billedSeconds: usage.billedSeconds,
          pricePerMinuteMicros: provider.pricePerMinuteMicros,
        },
      }).catch((error: unknown) => console.error(JSON.stringify({
        level: 'error', service: 'pulpo-worker', event: 'recording.transcript.charge_failed', clipId, error: error instanceof Error ? error.message : String(error),
      })))
    }
    await publishFilesChange(row.userId)
  } catch (error) {
    if (!options.finalAttempt && retryable(error)) throw error
    const message = error instanceof AppError ? error.message
      : error instanceof GroqTranscriptionError && error.status === 429 ? 'Transcription is busy right now.'
        : 'The transcript could not be made.'
    if (await settleTranscript(clipId, { transcriptStatus: 'failed', transcriptError: message })) await publishFilesChange(row.userId)
  }
}
