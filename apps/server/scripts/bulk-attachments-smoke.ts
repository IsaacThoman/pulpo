// Run only against the disposable local QA database and API documented in docs/attachments.md.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import sharp from 'sharp'
import { io } from 'socket.io-client'
import { ComposerSync, createUploadQueue, retryBusyUpload } from '@pulpo/client-core'
import { emptyComposerState, type ComposerAck, type ComposerCheckpoint } from '@pulpo/contracts'
import { eq } from 'drizzle-orm'

const databaseUrl = new URL(process.env.DATABASE_URL ?? 'http://invalid')
const origin = process.env.BULK_QA_ORIGIN ?? 'http://127.0.0.1:3000'
assert.equal(databaseUrl.pathname, '/pulpo_bulk_qa')
assert(['localhost', '127.0.0.1'].includes(databaseUrl.hostname))
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
const { db, queryClient } = await import('../src/database/client.js')
const { users, passwordCredentials } = await import('../src/database/schema.js')
const [admin] = await db.select().from(users).where(eq(users.email, 'bulk@example.test'))
assert(admin, 'Create the disposable bulk@example.test administrator first')
const [credential] = await db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, admin.id))
assert(credential)
const peerId = randomUUID()
const peerEmail = `bulk-${peerId}@example.test`
await db.insert(users).values({ id: peerId, name: 'Bulk peer QA', username: `bulk_${peerId.replaceAll('-', '').slice(0, 20)}`, email: peerEmail, role: 'user' })
await db.insert(passwordCredentials).values({ userId: peerId, passwordHash: credential.passwordHash })
await queryClient`create table if not exists bulk_qa_reference_events (draft_id uuid, operation text)`
await queryClient.unsafe(`create or replace function bulk_qa_record_reference() returns trigger language plpgsql as $$ begin
  insert into bulk_qa_reference_events values (coalesce(new.draft_id, old.draft_id), TG_OP); return coalesce(new, old); end $$`)
await queryClient.unsafe('drop trigger if exists bulk_qa_references on composer_draft_attachments')
await queryClient.unsafe('create trigger bulk_qa_references after insert or delete or update on composer_draft_attachments for each row execute function bulk_qa_record_reference()')
const image = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#456789' } }).png().toBuffer()
const started = performance.now()

async function run(email: string) {
  const login = await fetch(`${origin}/api/mobile/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Bulk-upload-qa-2026', deviceLabel: 'Bulk load QA' }) }).then((r) => r.json())
  assert(login.session?.token, JSON.stringify(login))
  const headers = { authorization: `Bearer ${login.session.token}`, 'content-type': 'application/json' }
  let activeUploads = 0, peakUploads = 0, writes = 0
  const call = async (path: string, body?: unknown) => retryBusyUpload(async () => {
    const response = await fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(JSON.stringify(result)), { status: response.status })
    return result
  })
  const chat = await call('/api/chats', { modelId: 'bulk-qa', title: '500-file performance validation' })
  const socket = io(origin, { transports: ['websocket'], auth: { sessionToken: login.session.token, composerSyncEnabled: true } })
  const saved = new Map<string, ComposerCheckpoint>()
  const sync = new ComposerSync({ load: async (id) => saved.get(id) ?? null, save: async (id, value) => { saved.set(id, structuredClone(value)) } }, randomUUID())
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject) })
    const rpc = (event: string, input: unknown) => new Promise<ComposerAck>((resolve, reject) => socket.timeout(10_000).emit(event, input, (error: Error | null, result: ComposerAck) => error ? reject(error) : resolve(result)))
    sync.connect({ read: (draftId) => rpc('composer.read', { draftId }), write: (input) => { writes++; return rpc('composer.write', input) } })
    await sync.open(chat.id, { ...emptyComposerState(), model: { id: 'bulk-qa', presets: {} } }, () => {})
    const enqueue = createUploadQueue(3)
    const ready = new Map<number, { id: string; name: string; mimeType: string; size: number }>()
    const uploadStart = performance.now()
    await Promise.all(Array.from({ length: 500 }, (_, index) => enqueue(async () => {
      const name = `batch-${String(index).padStart(3, '0')}.${index < 300 ? 'png' : 'txt'}`
      const bytes = index < 300 ? image : Buffer.from(`File ${index}`)
      const mimeType = index < 300 ? 'image/png' : 'text/plain'
      const reservation = await call('/api/attachments', { chatId: chat.id, originalName: name, mimeType, sizeBytes: bytes.length })
      await retryBusyUpload(async () => {
        peakUploads = Math.max(peakUploads, ++activeUploads)
        try {
          const response = await fetch(`${origin}${reservation.uploadUrl}`, { method: 'PUT', headers: { ...headers, ...reservation.uploadHeaders }, body: bytes })
          if (!response.ok) throw Object.assign(new Error(await response.text()), { status: response.status })
          await response.arrayBuffer()
        } finally { activeUploads-- }
      })
      const confirmed = await call(`/api/attachments/${reservation.attachment.id}/confirm`, {})
      ready.set(index, { id: confirmed.id, name, mimeType: confirmed.mimeType, size: bytes.length })
      sync.edit(chat.id, { attachments: [...ready].sort(([a], [b]) => a - b).map(([, item]) => item) })
    })))
    await sync.flush(chat.id)
    const uploadMs = Math.round(performance.now() - uploadStart)
    const snapshot = await rpc('composer.read', { draftId: chat.id })
    assert(snapshot.ok)
    assert.equal(snapshot.snapshot.state.attachments.length, 500)
    assert.equal(snapshot.snapshot.state.attachments[0]?.name, 'batch-000.png')
    assert.equal(snapshot.snapshot.state.attachments[499]?.name, 'batch-499.txt')
    assert.equal(peakUploads, 3)
    const uploadWrites = writes
    const before = await queryClient`select operation, count(*)::int as count from bulk_qa_reference_events where draft_id=(select id from composer_drafts where chat_id=${chat.id}) group by operation`
    const inserted = before.find((row) => row.operation === 'INSERT')?.count ?? 0
    const deleted = before.find((row) => row.operation === 'DELETE')?.count ?? 0
    assert.equal(inserted - deleted, 500)
    assert(inserted < 750, 'Upload sync must not rewrite the full growing attachment list')
    for (let index = 0; index < 20; index++) { sync.edit(chat.id, { content: `Typing ${index}` }); await sync.flush(chat.id) }
    const after = await queryClient`select operation, count(*)::int as count from bulk_qa_reference_events where draft_id=(select id from composer_drafts where chat_id=${chat.id}) group by operation`
    assert.deepEqual([...after], [...before], 'Typing must not rewrite attachment references')
    const previews = createUploadQueue(2)
    const imageIds = [...ready].filter(([index]) => index < 300).map(([, file]) => file.id)
    const previewStart = performance.now()
    await Promise.all(imageIds.map((id) => previews(async () => {
      const response = await fetch(`${origin}/api/attachments/${id}/thumbnail`, { headers })
      assert.equal(response.status, 200, await response.clone().text().then((s) => s.slice(0, 100)))
      assert.equal(response.headers.get('content-type'), 'image/webp')
      assert((await response.arrayBuffer()).byteLength > 0)
    })))
    const previewMs = Math.round(performance.now() - previewStart)
    const warmStart = performance.now()
    await Promise.all(imageIds.map((id) => previews(async () => {
      const response = await fetch(`${origin}/api/attachments/${id}/thumbnail`, { headers })
      assert.equal(response.status, 200); await response.arrayBuffer()
    })))
    return { chatId: chat.id, files: ready.size, peakUploads, uploadMs, uploadWrites, referenceInserts: inserted, referenceDeletes: deleted, referenceWritesDuringTyping: 0, previewMs, warmPreviewMs: Math.round(performance.now() - warmStart) }
  } finally { sync.dispose(); socket.close() }
}
try {
  const settled = await Promise.allSettled([run('bulk@example.test'), run(peerEmail)])
  const results = settled.map((result) => { if (result.status === 'rejected') throw result.reason; return result.value })
  console.log(JSON.stringify({ elapsedMs: Math.round(performance.now() - started), users: results }, null, 2))
} finally {
  await queryClient.unsafe('drop trigger if exists bulk_qa_references on composer_draft_attachments')
  await queryClient.end()
}
