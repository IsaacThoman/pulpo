import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { DOC_GENERATION_KEY, DOC_META_MAP } from '@pulpo/client-core/doc-schema'
import { liveAssetHash } from '@pulpo/client-core/office'
import { db, queryClient } from '../database/client.js'
import { fileDocAssets, fileDocs, fileNodes, users } from '../database/schema.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../storage/index.js', async () => {
  const { memoryBlobStore } = await import('./agent/test-blob-store.js')
  return { getBlobStore: () => memoryBlobStore(objects) }
})
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn(), publishDocUpdate: vi.fn() }))
vi.mock('../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))
// The routes' sign-in: the test names the user in a header.
vi.mock('./request.js', () => ({
  requireFilesUser: async (request: { headers: Record<string, string | undefined> }) => ({ id: request.headers['x-test-user'] }),
}))

const { registerLiveDocRoutes } = await import('./live-routes.js')
const { appendDocUpdate, compactDoc, createDoc, docGeneration, loadYDoc } = await import('./doc-store.js')
const { convertBlobToDocInTx } = await import('./conversion.js')
const { mutateFileTree, updateFileNode } = await import('./tree-service.js')
const { ASSET_GRACE_MS } = await import('./asset-gc.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let app: FastifyInstance
let userId: string

async function user(): Promise<string> {
  const id = randomUUID()
  await db.insert(users).values({ id, name: 'Routes test', email: `${id}@example.test`, username: `r${id.replaceAll('-', '')}`, role: 'user', storageLimitBytes: 10_000_000 })
  return id
}

async function edit(nodeId: string, change: (text: Y.Text) => void) {
  const doc = await loadYDoc(nodeId)
  const vector = Y.encodeStateVector(doc)
  change(doc.getText('text'))
  await appendDocUpdate({ nodeId, ownerUserId: userId, actorUserId: userId, update: Y.encodeStateAsUpdate(doc, vector), origin: 'client' })
}

describe.skipIf(!enabled)('live document routes and lifecycle', () => {
  beforeAll(async () => {
    app = Fastify()
    app.addContentTypeParser('application/octet-stream', (_request, body, done) => done(null, body))
    await registerLiveDocRoutes(app)
    await app.ready()
  })
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = await user()
  })
  afterAll(async () => {
    await app.close()
    await queryClient.end()
  })

  it('exports a document as an untrusted download, only to its owner', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'page.html' })
    await edit(node.id, (text) => text.insert(0, '<script>alert(1)</script>\n'))
    const response = await app.inject({ url: `/api/files/${node.id}/export`, headers: { 'x-test-user': userId } })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('<script>alert(1)</script>\n')
    expect(response.headers).toMatchObject({
      'content-disposition': "attachment; filename*=UTF-8''page.html",
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    })
    const stranger = await user()
    expect((await app.inject({ url: `/api/files/${node.id}/export`, headers: { 'x-test-user': stranger } })).statusCode).toBe(404)
  })

  it('stores and serves assets by hash, never as active content', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'notes.txt' })
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const put = await app.inject({
      method: 'PUT', url: `/api/files/${node.id}/assets?type=image/svg%2Bxml`, payload: svg,
      headers: { 'x-test-user': userId, 'content-type': 'application/octet-stream' },
    })
    expect(put.statusCode).toBe(200)
    const hash = await liveAssetHash(svg)
    expect(put.json()).toEqual({ hash, mimeType: 'image/svg+xml', sizeBytes: svg.byteLength })
    const get = await app.inject({ url: `/api/files/${node.id}/assets/${hash}`, headers: { 'x-test-user': userId } })
    expect(get.statusCode).toBe(200)
    expect(get.rawPayload.equals(svg)).toBe(true)
    expect(get.headers).toMatchObject({
      'content-type': 'application/octet-stream', 'x-pulpo-asset-type': 'image/svg+xml',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    })
    expect(get.headers['content-disposition']).toMatch(/^attachment/)
    // Another account's document, a malformed hash, and a bad type are refused.
    const stranger = await user()
    expect((await app.inject({ url: `/api/files/${node.id}/assets/${hash}`, headers: { 'x-test-user': stranger } })).statusCode).toBe(404)
    expect((await app.inject({ url: `/api/files/${node.id}/assets/../../etc`, headers: { 'x-test-user': userId } })).statusCode).toBeGreaterThanOrEqual(400)
    expect((await app.inject({
      method: 'PUT', url: `/api/files/${node.id}/assets?type=text/html;charset=x`, payload: svg,
      headers: { 'x-test-user': userId, 'content-type': 'application/octet-stream' },
    })).statusCode).toBeGreaterThanOrEqual(400)
    // An upload past the storage allowance is refused.
    await db.update(users).set({ storageLimitBytes: 10 }).where(eq(users.id, userId))
    const big = await app.inject({
      method: 'PUT', url: `/api/files/${node.id}/assets`, payload: Buffer.alloc(1_000, 1),
      headers: { 'x-test-user': userId, 'content-type': 'application/octet-stream' },
    })
    expect(big.statusCode).toBe(413)
  })

  it('gives a document made again from its file a new generation, and says so on its state', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'main.py' })
    const first = await docGeneration(node.id)
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect((await loadYDoc(node.id)).getMap(DOC_META_MAP).get(DOC_GENERATION_KEY)).toBe(first)
    await updateFileNode(userId, node.id, { name: 'main.py.bak' })
    await updateFileNode(userId, node.id, { name: 'main.py' })
    await mutateFileTree(userId, async (tx) => {
      const [row] = await tx.select().from(fileNodes).where(eq(fileNodes.id, node.id))
      return convertBlobToDocInTx(tx, row!)
    })
    const second = await docGeneration(node.id)
    expect(second).not.toBe(first)
    expect((await loadYDoc(node.id)).getMap(DOC_META_MAP).get(DOC_GENERATION_KEY)).toBe(second)
  })

  it('collects assets nothing refers to any more, after a grace period', async () => {
    const node = await createDoc(userId, { parentId: null, name: 'mixed.txt' })
    const mixed = Buffer.from('a\r\nb\nc\r\n')
    // The original bytes of a file with mixed line breaks are kept as an asset the text refers to.
    await mutateFileTree(userId, async (tx) => {
      const { DocAssetStore } = await import('./live-docs.js')
      const store = new DocAssetStore(tx, node.id)
      await store.put(Buffer.from('an orphan'), 'application/octet-stream')
      await store.flush(tx, userId, node.id)
    })
    const doc = await loadYDoc(node.id)
    const vector = Y.encodeStateVector(doc)
    const { textCodec } = await import('@pulpo/client-core/office/text')
    const { DocAssetStore } = await import('./live-docs.js')
    const assets = new DocAssetStore(db, node.id)
    await textCodec.applyFile(doc, mixed, { name: 'mixed.txt', assets }, 'client')
    await mutateFileTree(userId, (tx) => assets.flush(tx, userId, node.id))
    await appendDocUpdate({ nodeId: node.id, ownerUserId: userId, actorUserId: userId, update: Y.encodeStateAsUpdate(doc, vector), origin: 'client' })
    expect(await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, node.id))).toHaveLength(2)
    // Within the grace period nothing goes.
    await compactDoc(node.id)
    expect(await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, node.id))).toHaveLength(2)
    const later = new Date(Date.now() + ASSET_GRACE_MS + 60_000)
    await edit(node.id, (text) => text.insert(0, 'z'))
    await compactDoc(node.id, later)
    const left = await db.select().from(fileDocAssets).where(eq(fileDocAssets.nodeId, node.id))
    // The original is kept while the text refers to it; the orphan is gone, object included.
    expect(left.map((row) => row.hash)).toEqual([createHash('sha256').update(mixed).digest('hex')])
    expect([...objects.keys()].filter((key) => key.includes(`/doc-assets/${node.id}/`))).toHaveLength(1)
    const [state] = await db.select({ markdown: fileDocs.markdown }).from(fileDocs).where(eq(fileDocs.nodeId, node.id))
    expect(state!.markdown).toBe('za\nb\nc\n')
  })
})
