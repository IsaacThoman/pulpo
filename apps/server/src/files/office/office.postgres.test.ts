import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { eq } from 'drizzle-orm'
import Fastify from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../../database/client.js'
import { applicationSettings, fileChanges, fileNodes } from '../../database/schema.js'
import { storageUsedBytes } from '../../attachments/storage-quota.js'
import { AppError } from '../../lib/errors.js'
import { filesFixture, requireDisposableDatabase, type FilesFixture } from '../agent/test-fixtures.js'

const objects = vi.hoisted(() => new Map<string, Buffer>())
const mocks = vi.hoisted(() => ({ config: {} as Record<string, unknown>, userId: '', publish: vi.fn() }))
vi.mock('../../storage/index.js', async () => {
  const { memoryBlobStore } = await import('../agent/test-blob-store.js')
  return { getBlobStore: () => memoryBlobStore(objects) }
})
vi.mock('../../responses/events.js', () => ({ publishStateChange: mocks.publish }))
vi.mock('../doc-events.js', () => ({ publishDocsClosed: vi.fn(), publishDocUpdate: vi.fn() }))
vi.mock('../../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))
vi.mock('../request.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../request.js')>(),
  requireFilesUser: async () => ({ id: mocks.userId }),
}))
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config.js')>()
  return { ...actual, getConfig: () => ({ ...actual.getConfig(), ...mocks.config }) }
})

const { convertFileToEditable, exportFileAsPdf } = await import('./service.js')
const { registerFileRoutes } = await import('../routes.js')
const { moveFileNodes, trashFileNode } = await import('../tree-service.js')
const { undoFileChanges } = await import('../agent/history.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
const TOKEN = 't'.repeat(40)
const DOCX = Buffer.from('PK\x03\x04 converted docx bytes')
const PDF = Buffer.from('%PDF-1.7 converted')

interface ConverterRequest { from: string | null; to: string | null; authorization?: string; body: Buffer }
type ConverterReply = { status: number; body: Buffer | object; delayMs?: number }

/** Stands in for the office converter service, answering as `reply` says. */
let converter: Server
let converterUrl: string
let reply: (request: ConverterRequest) => ConverterReply
const received: ConverterRequest[] = []

let files: FilesFixture

async function nodesNamed(name: string) {
  return (await db.select().from(fileNodes).where(eq(fileNodes.ownerUserId, files.userId))).filter((node) => node.name === name)
}

async function appError(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return { status: error.statusCode, code: error.code }
    throw error
  }
  throw new Error('expected an AppError')
}

describe.skipIf(!enabled)('office file conversion', () => {
  beforeAll(async () => {
    converter = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const url = new URL(request.url!, 'http://converter')
      const call = { from: url.searchParams.get('from'), to: url.searchParams.get('to'), authorization: request.headers.authorization, body: Buffer.concat(chunks) }
      received.push(call)
      const answer = reply(call)
      if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs))
      if (response.destroyed) return
      const body = Buffer.isBuffer(answer.body) ? answer.body : Buffer.from(JSON.stringify(answer.body))
      response.writeHead(answer.status, { 'content-type': Buffer.isBuffer(answer.body) ? 'application/octet-stream' : 'application/json' })
      response.end(body)
    })
    await new Promise<void>((resolve) => converter.listen(0, '127.0.0.1', resolve))
    converterUrl = `http://127.0.0.1:${(converter.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    await new Promise((resolve) => converter.close(resolve))
    await queryClient.end()
  })
  beforeEach(async () => {
    requireDisposableDatabase()
    files = await filesFixture()
    mocks.userId = files.userId
    mocks.config = { OFFICE_CONVERTER_URL: converterUrl, OFFICE_CONVERTER_TOKEN: TOKEN }
    received.length = 0
    reply = ({ to }) => ({ status: 200, body: to === 'pdf' ? PDF : DOCX })
  })
  afterEach(async () => {
    await db.delete(applicationSettings).where(eq(applicationSettings.key, 'auth'))
  })

  describe('in Files', () => {
    it('adds the converted file beside the original under a free name, keeping the original', async () => {
      const folder = await files.folder('Reports')
      const original = await files.blob('Q3.doc', folder, 'legacy word bytes', 'application/msword')
      await files.blob('Q3.docx', folder, 'already here')
      const before = await storageUsedBytes(db, files.userId)

      const converted = await convertFileToEditable(files.userId, original, 'docx')

      expect(converted).toMatchObject({
        parentId: folder, kind: 'blob', name: 'Q3 (2).docx', status: 'ready', sizeBytes: DOCX.byteLength,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      expect(await files.content(converted.id)).toBe(DOCX.toString())
      expect(await files.content(original)).toBe('legacy word bytes')
      expect(received).toEqual([{ from: 'doc', to: 'docx', authorization: `Bearer ${TOKEN}`, body: Buffer.from('legacy word bytes') }])
      expect(await storageUsedBytes(db, files.userId)).toBe(before + DOCX.byteLength)
    })

    it('puts the copy where the original is once converted, and stores nothing if it was trashed meanwhile', async () => {
      const from = await files.folder('Inbox')
      const to = await files.folder('Archive 2024')
      const moved = await files.blob('Budget.xls', from, 'xls bytes')
      reply = () => ({ status: 200, body: DOCX, delayMs: 300 })
      const converting = convertFileToEditable(files.userId, moved, 'xlsx')
      await new Promise((resolve) => setTimeout(resolve, 100))
      await moveFileNodes(files.userId, [{ id: moved, parentId: to }])
      expect(await converting).toMatchObject({ parentId: to, name: 'Budget.xlsx' })

      const trashed = await files.blob('Deck.ppt', from, 'ppt bytes')
      const keysBefore = new Set(objects.keys())
      const failing = convertFileToEditable(files.userId, trashed, 'pptx')
      await new Promise((resolve) => setTimeout(resolve, 100))
      await trashFileNode(files.userId, trashed)
      expect(await appError(failing)).toMatchObject({ status: 404 })
      expect(await nodesNamed('Deck.pptx')).toEqual([])
      // The converted bytes were stored and then deleted again.
      expect([...objects.keys()].filter((key) => !keysBefore.has(key))).toEqual([])
    })

    it('keeps the bytes of a converted file that committed when announcing it fails', async () => {
      const projects = await files.folder('Projects')
      const doc = await files.blob('Spec.doc', projects, 'doc bytes')
      await files.attach({ [projects]: 'write' })
      mocks.publish.mockRejectedValueOnce(new Error('Redis is down'))
      await expect(convertFileToEditable(files.userId, doc, 'docx')).rejects.toThrow('Redis is down')
      const [userCopy] = await nodesNamed('Spec.docx')
      expect(await files.content(userCopy!.id)).toBe(DOCX.toString())
      mocks.publish.mockRejectedValueOnce(new Error('Redis is down'))
      await files.relay('convert', { path: 'Projects/Spec.doc', to: 'pdf' })
      const [agentCopy] = await nodesNamed('Spec.pdf')
      expect(await files.content(agentCopy!.id)).toBe(PDF.toString())
    })

    it('keeps committed conversion bytes when a push replaces them before notification fails', async () => {
      const projects = await files.folder('Projects')
      const doc = await files.blob('Spec.doc', projects, 'doc bytes')
      await files.attach({ [projects]: 'write' })
      mocks.publish.mockImplementationOnce(async () => {
        files.put('/workspace/new.docx', 'updated docx')
        await files.ok('push', { items: [{ local: '/workspace/new.docx', remote: 'Projects/Spec.docx', base: null, force: true }] })
        throw new Error('Redis is down')
      })
      await expect(convertFileToEditable(files.userId, doc, 'docx')).rejects.toThrow('Redis is down')
      const [copy] = await nodesNamed('Spec.docx')
      expect(await files.content(copy!.id)).toBe('updated docx')
      await undoFileChanges(files.userId, files.responseId)
      expect(await files.content(copy!.id)).toBe(DOCX.toString())
    })

    it('refuses what it cannot convert without calling the converter', async () => {
      const doc = await files.blob('Letter.doc', null, 'x')
      expect(await appError(convertFileToEditable(files.userId, doc, 'xlsx'))).toEqual({ status: 400, code: 'office_conversion_unsupported' })
      const docx = await files.blob('Letter.docx', null, 'x')
      expect(await appError(convertFileToEditable(files.userId, docx, 'docx'))).toEqual({ status: 400, code: 'office_conversion_unsupported' })
      const png = await files.blob('photo.png', null, 'x')
      expect(await appError(exportFileAsPdf(files.userId, png))).toEqual({ status: 400, code: 'office_conversion_unsupported' })
      const markdown = await files.doc('Notes.md', null, '# Notes')
      expect(await appError(exportFileAsPdf(files.userId, markdown))).toMatchObject({ status: 404 })
      const folder = await files.folder('Folder.doc')
      expect(await appError(convertFileToEditable(files.userId, folder, 'docx'))).toMatchObject({ status: 404 })
      const other = await filesFixture()
      expect(await appError(convertFileToEditable(other.userId, doc, 'docx'))).toMatchObject({ status: 404 })
      mocks.config = {}
      expect(await appError(convertFileToEditable(files.userId, doc, 'docx'))).toEqual({ status: 404, code: 'office_conversion_unavailable' })
      expect(received).toEqual([])
    })

    it('explains converter failures', async () => {
      const doc = await files.blob('Locked.doc', null, 'x')
      const cases: Array<[ConverterReply, { status: number; code: string }]> = [
        [{ status: 422, body: { error: { code: 'encrypted', message: 'locked' } } }, { status: 422, code: 'office_file_encrypted' }],
        [{ status: 422, body: { error: { code: 'conversion_failed', message: 'damaged' } } }, { status: 422, code: 'office_conversion_failed' }],
        [{ status: 415, body: { error: { code: 'unexpected_content', message: 'not a doc' } } }, { status: 415, code: 'office_file_unreadable' }],
        [{ status: 503, body: { error: { code: 'busy', message: 'busy' } } }, { status: 503, code: 'office_converter_busy' }],
        [{ status: 504, body: { error: { code: 'timeout', message: 'slow' } } }, { status: 504, code: 'office_conversion_timeout' }],
        [{ status: 500, body: Buffer.from('<html>proxy error</html>') }, { status: 502, code: 'office_converter_unavailable' }],
        [{ status: 401, body: { error: { code: 'unauthorized', message: 'no' } } }, { status: 502, code: 'office_converter_unavailable' }],
      ]
      for (const [answer, expected] of cases) {
        reply = () => answer
        expect(await appError(convertFileToEditable(files.userId, doc, 'docx'))).toEqual(expected)
      }
      mocks.config = { OFFICE_CONVERTER_URL: 'http://127.0.0.1:9', OFFICE_CONVERTER_TOKEN: TOKEN }
      expect(await appError(convertFileToEditable(files.userId, doc, 'docx'))).toEqual({ status: 502, code: 'office_converter_unavailable' })
      mocks.config = { OFFICE_CONVERTER_URL: converterUrl, OFFICE_CONVERTER_TIMEOUT_SECONDS: 1 }
      reply = () => ({ status: 200, body: DOCX, delayMs: 2_000 })
      expect(await appError(convertFileToEditable(files.userId, doc, 'docx'))).toEqual({ status: 504, code: 'office_conversion_timeout' })
      expect(await nodesNamed('Locked.docx')).toEqual([])
    })

    it('keeps converted files within the storage allowance and the per-file cap', async () => {
      const small = await filesFixture({ storageLimitBytes: 40 })
      mocks.userId = small.userId
      const doc = await small.blob('Big.doc', null, '0123456789')
      const keysBefore = new Set(objects.keys())
      reply = () => ({ status: 200, body: Buffer.alloc(100, 1) })
      expect(await appError(convertFileToEditable(small.userId, doc, 'docx'))).toMatchObject({ status: 413 })
      expect([...objects.keys()].filter((key) => !keysBefore.has(key))).toEqual([])

      await db.insert(applicationSettings).values({ key: 'auth', value: { maxAttachmentBytes: 1024 * 1024 } })
      reply = () => ({ status: 200, body: Buffer.alloc(2 * 1024 * 1024, 1) })
      const capped = await files.blob('Huge.doc', null, 'x')
      expect(await appError(convertFileToEditable(files.userId, capped, 'docx'))).toEqual({ status: 413, code: 'office_file_too_large' })
    })

    it('limits each account to two conversions at a time, agents included', async () => {
      const projects = await files.folder('Projects')
      await files.blob('agent.odt', projects, 'agent')
      await files.attach({ [projects]: 'write' })
      const ids = await Promise.all(['a', 'b'].map((name) => files.blob(`${name}.odt`, null, name)))
      reply = () => ({ status: 200, body: DOCX, delayMs: 300 })
      const agent = files.relay('convert', { path: 'Projects/agent.odt', to: 'docx' })
      await vi.waitFor(() => expect(received.some((call) => call.body.toString() === 'agent')).toBe(true))
      const results = await Promise.allSettled(ids.map((id) => convertFileToEditable(files.userId, id, 'docx')))
      expect((await agent).ok).toBe(true)
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const refused = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
      expect(refused.reason).toMatchObject({ statusCode: 429, code: 'office_conversion_rate_limited' })
    })

    it('exports PDF without storing anything', async () => {
      const deck = await files.blob('Pitch.key', null, 'keynote bytes')
      const rows = (await db.select().from(fileNodes).where(eq(fileNodes.ownerUserId, files.userId))).length
      expect(await exportFileAsPdf(files.userId, deck)).toEqual({ name: 'Pitch.pdf', bytes: new Uint8Array(PDF) })
      expect(received.at(-1)).toMatchObject({ from: 'key', to: 'pdf' })
      expect((await db.select().from(fileNodes).where(eq(fileNodes.ownerUserId, files.userId))).length).toBe(rows)
    })

    it('serves both over HTTP with validation and download headers', async () => {
      const app = Fastify()
      await registerFileRoutes(app)
      try {
        const sheet = await files.blob('Plan Ünïcode.ods', null, 'ods bytes')
        const created = await app.inject({ method: 'POST', url: `/api/files/${sheet}/conversions`, payload: { to: 'xlsx' } })
        expect(created.statusCode).toBe(201)
        expect(created.json()).toMatchObject({ name: 'Plan Ünïcode.xlsx', kind: 'blob' })
        const invalid = await app.inject({ method: 'POST', url: `/api/files/${sheet}/conversions`, payload: { to: 'odt' } })
        expect(invalid.statusCode).toBeGreaterThanOrEqual(400)
        expect(received.filter((call) => call.to === 'odt')).toEqual([])

        const pdf = await app.inject({ method: 'GET', url: `/api/files/${sheet}/pdf` })
        expect(pdf.statusCode).toBe(200)
        expect(pdf.headers['content-type']).toBe('application/pdf')
        expect(pdf.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('Plan Ünïcode.pdf')}`)
        expect(pdf.headers['x-content-type-options']).toBe('nosniff')
        expect(pdf.rawPayload.equals(PDF)).toBe(true)
        const inline = await app.inject({ method: 'GET', url: `/api/files/${sheet}/pdf?inline=1` })
        expect(inline.headers['content-disposition']).toMatch(/^inline; /)
      } finally {
        await app.close()
      }
    })
  })

  describe('pulpo files convert', () => {
    it('creates the converted copy in Write mode, recorded so undo removes it', async () => {
      const projects = await files.folder('Projects')
      await files.blob('Budget.xls', projects, 'xls bytes')
      await files.attach({ [projects]: 'write' })
      const result = await files.ok('convert', { path: 'Projects/Budget.xls', to: 'xlsx' })
      expect(result.output).toBe('Converted "Projects/Budget.xls" to "Projects/Budget.xlsx"')
      const [created] = await nodesNamed('Budget.xlsx')
      expect(created).toMatchObject({ parentId: projects, suggestionChangeId: null })
      const [row] = await db.select().from(fileChanges).where(eq(fileChanges.nodeId, created!.id))
      expect(row).toMatchObject({ kind: 'create', mode: 'write' })
      expect(files.changes.at(-1)).toBe(1)
      await undoFileChanges(files.userId, files.responseId)
      expect((await files.node(created!.id))?.trashedAt ?? null).not.toBeNull()
    })

    it('suggests the copy in Suggest mode and converts what the agent sees', async () => {
      const projects = await files.folder('Projects')
      const deck = await files.blob('Deck.ppt', projects, 'original ppt')
      await files.attach({ [projects]: 'suggest' })
      files.put('/workspace/new.ppt', 'proposed ppt')
      const pushed = await files.ok('push', { items: [{ local: '/workspace/new.ppt', remote: 'Projects/Deck.ppt', base: null, force: true }] })
      expect(JSON.stringify(pushed.data)).toContain('suggested')
      await files.ok('convert', { path: 'Projects/Deck.ppt', to: 'pdf' })
      expect(received.at(-1)).toMatchObject({ from: 'ppt', to: 'pdf', body: Buffer.from('proposed ppt') })
      const [created] = await nodesNamed('Deck.pdf')
      expect(created!.suggestionChangeId).not.toBeNull()
      expect(await files.content(deck)).toBe('original ppt')
    })

    it('picks the free name once the conversion is done', async () => {
      const projects = await files.folder('Projects')
      await files.blob('Slides.odp', projects, 'odp')
      await files.attach({ [projects]: 'write' })
      reply = () => ({ status: 200, body: DOCX, delayMs: 300 })
      const converting = files.ok('convert', { path: 'Projects/Slides.odp', to: 'pptx' })
      await new Promise((resolve) => setTimeout(resolve, 100))
      await files.blob('Slides.pptx', projects, 'someone else')
      expect((await converting).output).toBe('Converted "Projects/Slides.odp" to "Projects/Slides (2).pptx"')
    })

    it('honours read-only folders, the scope, and --output', async () => {
      const shared = await files.folder('Shared')
      const out = await files.folder('Out')
      await files.blob('Spec.odt', shared, 'odt')
      const single = await files.blob('Alone.rtf', null, 'rtf')
      await files.blob('Taken.docx', out, 'x')
      await files.attach({ [shared]: 'read', [out]: 'write', [single]: 'read' })
      expect(await files.error('convert', { path: 'Shared/Spec.odt', to: 'docx' })).toMatch(/read only/)
      expect(await files.error('convert', { path: 'Alone.rtf', to: 'docx' })).toMatch(/--output/)
      expect(await files.error('convert', { path: 'Shared/Spec.odt', to: 'docx', output: 'Out/Taken.docx' })).toMatch(/already exists/)
      expect(await files.error('convert', { path: 'Shared/Spec.odt', to: 'docx', output: 'Out/Spec.pdf' })).toMatch(/must end in \.docx/)
      expect(await files.error('convert', { path: 'Shared/Spec.odt', to: 'xlsx' })).toMatch(/converts to \.docx or \.pdf/)
      expect(await files.error('convert', { path: 'Shared', to: 'pdf' })).toMatch(/not an uploaded file/)
      expect(received).toEqual([])
      expect((await files.ok('convert', { path: 'Alone.rtf', to: 'docx', output: 'Out/Alone.docx' })).output).toBe('Converted "Alone.rtf" to "Out/Alone.docx"')
      expect((await nodesNamed('Alone.docx'))[0]).toMatchObject({ parentId: out })
    })

    it('validates arguments and explains when the server cannot convert', async () => {
      const projects = await files.folder('Projects')
      await files.blob('Old.doc', projects, 'doc')
      await files.attach({ [projects]: 'write' })
      expect(await files.error('convert', { path: 'Projects/Old.doc', to: 'odt' })).toMatch(/Invalid arguments/)
      expect(await files.error('convert', { path: 'Projects/Old.doc', to: 'docx', force: true })).toMatch(/Invalid arguments/)
      reply = () => ({ status: 422, body: { error: { code: 'encrypted', message: 'locked' } } })
      expect(await files.error('convert', { path: 'Projects/Old.doc', to: 'docx' })).toMatch(/password-protected/)
      mocks.config = {}
      expect(await files.error('convert', { path: 'Projects/Old.doc', to: 'docx' })).toMatch(/soffice --headless/)
      expect(await nodesNamed('Old.docx')).toEqual([])
    })
  })
})
