import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '../config.js'
import { db, queryClient } from '../database/client.js'
import { applicationSettings, creditLedger, fileDocs, fileNodes, users } from '../database/schema.js'
import { encryptSecret } from '../lib/crypto.js'

vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn() }))
vi.mock('../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))

const { importUrlAsDoc } = await import('./url-import.js')
const { createFolder, trashFileNode } = await import('./tree-service.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

async function configureWebTools(overrides: Record<string, unknown> = {}) {
  const value = {
    extractEnabled: true,
    extractProviderOrder: ['kagi', 'firecrawl'],
    kagi: { extractEnabled: true, billExtracts: false, extractPriceMicros: 6_000 },
    firecrawl: { extractEnabled: true, billExtracts: false, extractPriceMicros: 9_000, baseUrl: 'https://firecrawl.internal/v2' },
    encryptedKagiApiKey: encryptSecret('kagi-secret', getConfig().ENCRYPTION_KEY),
    ...overrides,
  }
  await db.insert(applicationSettings).values({ key: 'webTools', value })
    .onConflictDoUpdate({ target: applicationSettings.key, set: { value } })
}

async function docsOf(owner: string) {
  return db.select({ name: fileNodes.name, parentId: fileNodes.parentId, markdown: fileDocs.markdown })
    .from(fileNodes).innerJoin(fileDocs, eq(fileDocs.nodeId, fileNodes.id))
    .where(and(eq(fileNodes.ownerUserId, owner), eq(fileNodes.kind, 'doc')))
}

describe.skipIf(!enabled)('Importing a web page into Files', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'URL import test', email: `${userId}@example.test`, username: `u${userId.replaceAll('-', '')}`, role: 'user' })
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await db.delete(applicationSettings).where(eq(applicationSettings.key, 'webTools'))
  })
  afterAll(async () => { await queryClient.end() })

  it('saves the page as a document named after it, in the chosen folder', async () => {
    await configureWebTools()
    const fetch = vi.fn().mockResolvedValue(json({
      meta: { trace: 't' }, data: [{ url: 'https://example.com/post', markdown: '# Hello world\n\nSome **bold** text.' }],
    }))
    vi.stubGlobal('fetch', fetch)
    const folder = await createFolder(userId, { parentId: null, name: 'Clippings' })

    const node = await importUrlAsDoc(userId, { parentId: folder.id, url: 'https://example.com/post' })

    expect(node).toMatchObject({ kind: 'doc', name: 'Hello world.md', parentId: folder.id })
    expect(fetch).toHaveBeenCalledWith('https://kagi.com/api/v1/extract', expect.objectContaining({ method: 'POST' }))
    const [doc] = await docsOf(userId)
    expect(doc!.markdown).toContain('Source: [https://example.com/post](https://example.com/post)')
    expect(doc!.markdown).toContain('Some **bold** text.')
  })

  it('falls back to the next provider and gives a taken name a suffix', async () => {
    await configureWebTools()
    const fetch = vi.fn(async (url: string) => url.startsWith('https://kagi.com')
      ? json({ data: [{ url: 'https://example.com/a', markdown: null, error: 'blocked' }] })
      : json({ success: true, id: 'fc-1', data: { markdown: 'Body', metadata: { title: 'Article', sourceURL: 'https://example.com/a' } } }))
    vi.stubGlobal('fetch', fetch)

    await importUrlAsDoc(userId, { parentId: null, url: 'https://example.com/a' })
    await importUrlAsDoc(userId, { parentId: null, url: 'https://example.com/a' })

    expect(fetch).toHaveBeenCalledWith('https://firecrawl.internal/v2/scrape', expect.anything())
    expect((await docsOf(userId)).map((doc) => doc.name).sort()).toEqual(['Article (2).md', 'Article.md'])
  })

  it('charges the price of the provider that answered', async () => {
    await configureWebTools({ kagi: { extractEnabled: true, billExtracts: true, extractPriceMicros: 6_000 } })
    await db.update(users).set({ balanceMicros: 50_000 }).where(eq(users.id, userId))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [{ url: 'https://example.com', markdown: 'Text' }] })))

    await importUrlAsDoc(userId, { parentId: null, url: 'https://example.com' })

    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, userId))
    expect(ledger).toEqual([expect.objectContaining({ type: 'url_import', amountMicros: -6_000, metadata: expect.objectContaining({ provider: 'kagi' }) })])
  })

  it('keeps no document when the charge fails', async () => {
    await configureWebTools({ kagi: { extractEnabled: true, billExtracts: true, extractPriceMicros: 6_000 } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [{ url: 'https://example.com', markdown: 'Text' }] })))

    await expect(importUrlAsDoc(userId, { parentId: null, url: 'https://example.com' })).rejects.toMatchObject({ statusCode: 402 })
    expect(await docsOf(userId)).toEqual([])
  })

  it('reports a page no provider could read', async () => {
    await configureWebTools()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('https://kagi.com')
      ? json({ data: [{ url: 'https://example.com', markdown: null, error: 'blocked' }] })
      : new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 })))

    await expect(importUrlAsDoc(userId, { parentId: null, url: 'https://example.com' })).rejects.toMatchObject({ statusCode: 502, code: 'url_import_failed' })
    expect(await docsOf(userId)).toEqual([])
  })

  it('checks the request before fetching anything', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(importUrlAsDoc(userId, { parentId: null, url: 'https://example.com' })).rejects.toMatchObject({ statusCode: 404, code: 'url_import_unavailable' })

    await configureWebTools()
    await expect(importUrlAsDoc(userId, { parentId: null, url: 'http://example.com' })).rejects.toMatchObject({ code: 'url_import_not_https' })
    await expect(importUrlAsDoc(userId, { parentId: null, url: 'example.com' })).rejects.toMatchObject({ code: 'url_import_invalid' })
    await expect(importUrlAsDoc(userId, { parentId: null, url: 'https://me:pw@example.com' })).rejects.toMatchObject({ code: 'url_import_credentials' })
    const folder = await createFolder(userId, { parentId: null, name: 'Old' })
    await trashFileNode(userId, folder.id)
    await expect(importUrlAsDoc(userId, { parentId: folder.id, url: 'https://example.com' })).rejects.toMatchObject({ statusCode: 404 })
    expect(fetch).not.toHaveBeenCalled()
  })
})
