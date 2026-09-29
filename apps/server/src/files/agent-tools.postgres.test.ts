import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { chats, fileNodes, models, providerConnections, responses, users } from '../database/schema.js'

const docUpdates = vi.hoisted(() => [] as string[])
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn() }))
vi.mock('./doc-events.js', () => ({ publishDocsClosed: vi.fn(), publishDocUpdate: async (docId: string) => { docUpdates.push(docId) } }))
vi.mock('../jobs.js', () => ({ fileDocQueue: { add: vi.fn() } }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ get: async () => new TextEncoder().encode('a,b\n1,2\n'), delete: vi.fn() }) }))

const { createFilesTools, listFileChanges, loadFileScope, revertFileChanges } = await import('./agent-tools.js')
const { createDoc, readDocMarkdown } = await import('./doc-store.js')
const { createFolder } = await import('./tree-service.js')

const enabled = process.env.PULPO_FILES_TESTS === 'true'
let userId: string
let responseId: string
let projectsId: string
let planId: string

async function tools() {
  const scope = await loadFileScope(userId, [projectsId])
  const byName = new Map(createFilesTools({ userId, responseId, scope, maxOutputBytes: 10_000 }).map((tool) => [tool.name, tool]))
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await byName.get(name)!.execute(randomUUID(), args as never)
    return (result.content[0] as { text: string }).text
  }
  return { call }
}

describe.skipIf(!enabled)('agent Files tools', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
    userId = randomUUID()
    responseId = randomUUID()
    const providerId = randomUUID(), modelId = `m-${randomUUID()}`, chatId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Agent files', email: `${userId}@example.test`, username: `a${userId.replaceAll('-', '')}`, role: 'user' })
    await db.insert(providerConnections).values({ id: providerId, name: 'Fixture', baseUrl: 'https://example.test/v1', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Fixture', contextWindow: 128_000, maxOutputTokens: 16_000 })
    await db.insert(chats).values({ id: chatId, userId, modelId })
    await db.insert(responses).values({ id: responseId, userId, chatId, modelId, input: [] })
    projectsId = (await createFolder(userId, { parentId: null, name: 'Projects' })).id
    planId = (await createDoc(userId, { parentId: projectsId, name: 'Plan.md', markdown: '# Plan\n\nFirst draft' })).id
    await db.insert(fileNodes).values({ id: randomUUID(), ownerUserId: userId, parentId: projectsId, kind: 'blob', name: 'data.csv', mimeType: 'text/csv', sizeBytes: 8, objectKey: `users/${userId}/files/csv` })
    const secret = await createFolder(userId, { parentId: null, name: 'Secret' })
    await createDoc(userId, { parentId: secret.id, name: 'private.md', markdown: 'hidden' })
    docUpdates.length = 0
  })
  afterAll(async () => { await queryClient.end() })

  it('lists, reads, edits, and creates inside the attached folder', async () => {
    const { call } = await tools()
    expect(await call('files_list', {})).toContain('Projects/')
    const listing = await call('files_list', { path: 'Projects' })
    expect(listing).toContain('Projects/Plan.md')
    expect(listing).toContain('Projects/data.csv')
    expect(await call('files_read', { path: 'projects/plan.md' })).toContain('First draft')
    expect(await call('files_read', { path: 'Projects/data.csv' })).toBe('a,b\n1,2\n')
    await call('files_edit', { path: 'Projects/Plan.md', edits: [{ old_text: 'First draft', new_text: 'Second draft' }] })
    expect((await readDocMarkdown(userId, planId)).markdown).toContain('Second draft')
    // Open editors get the edit as a live update.
    expect(docUpdates).toEqual([planId])
    await call('files_create_folder', { path: 'Projects/Drafts' })
    expect(await call('files_write', { path: 'Projects/Drafts/Idea.md', content: '# Idea' })).toBe('Created Projects/Drafts/Idea.md')
  })

  it('reaches nothing outside the attached items', async () => {
    const { call } = await tools()
    await expect(call('files_read', { path: 'Secret/private.md' })).rejects.toThrow(/not attached/)
    await expect(call('files_read', { path: 'Projects/../Secret/private.md' })).rejects.toThrow(/"\."|".."/)
    await expect(call('files_write', { path: 'Loose.md', content: 'x' })).rejects.toThrow(/inside an attached folder/)
    await expect(call('files_write', { path: 'Projects/notes.txt', content: 'x' })).rejects.toThrow(/Only Markdown/)
    await expect(call('files_write', { path: 'Projects/data.csv', content: 'x' })).rejects.toThrow(/uploaded file/)
  })

  it('undoes a response: documents get their old text back and created items go to the trash', async () => {
    const { call } = await tools()
    await call('files_edit', { path: 'Projects/Plan.md', edits: [{ old_text: 'First draft', new_text: 'Changed' }] })
    await call('files_edit', { path: 'Projects/Plan.md', edits: [{ old_text: 'Changed', new_text: 'Changed again' }] })
    await call('files_write', { path: 'Projects/New.md', content: '# New' })
    expect((await listFileChanges(userId, responseId)).map((change) => [change.name, change.change])).toEqual([['Plan.md', 'edit'], ['New.md', 'create']])
    expect(await revertFileChanges(userId, responseId)).toEqual({ reverted: 2 })
    expect((await readDocMarkdown(userId, planId)).markdown).toContain('First draft')
    const [created] = await db.select().from(fileNodes).where(eq(fileNodes.name, 'New.md'))
    expect(created?.trashedAt).not.toBeNull()
    expect((await listFileChanges(userId, responseId)).every((change) => change.reverted)).toBe(true)
    expect(await revertFileChanges(userId, responseId)).toEqual({ reverted: 0 })
  })
})
