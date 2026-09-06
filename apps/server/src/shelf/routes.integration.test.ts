import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, queryClient } from '../database/client.js'
import { attachments, chats, models, providerConnections, shelvedDrafts, users } from '../database/schema.js'
import { mutateShelf, shelfAttachmentIsLive } from './routes.js'
import type { ShelfMutation } from '@pulpo/contracts'

const publish = vi.hoisted(() => vi.fn())
vi.mock('../responses/events.js', () => ({ publishStateChange: publish }))
const enabled = process.env.PULPO_SHELF_TESTS === 'true'
let userId: string
const mutate = (action: ShelfMutation['action'], operationId = randomUUID()) => mutateShelf(userId, { operationId, action })
const save = (content: string, attachmentIds: string[] = [], id = randomUUID()) => mutate({ type: 'save', draft: { id, content, attachmentIds } })

describe.skipIf(!enabled)('shelf PostgreSQL transactions', () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL?.endsWith('/pulpo_shelf_test')) throw new Error('Use the disposable pulpo_shelf_test database')
    userId = randomUUID()
    await db.insert(users).values({ id: userId, name: 'Shelf test', email: `${userId}@example.test`, username: `s${userId.replaceAll('-', '')}`, role: 'user' })
    publish.mockClear()
  })
  afterAll(async () => { await queryClient.end() })

  it('preserves exact text, canonical attachment metadata, order, and references', async () => {
    const ids = [randomUUID(), randomUUID()]
    await db.insert(attachments).values(ids.map((id, i) => ({ id, userId, originalName: `file-${i}.txt`, mimeType: 'text/plain', sizeBytes: 12, objectKey: id, status: 'ready' as const })))
    const result = await save('  half baked\n\n  ', ids.slice().reverse())
    expect(result.drafts[0]?.content).toBe('  half baked\n\n  ')
    expect(result.drafts[0]?.attachments.map((a) => a.id)).toEqual(ids.slice().reverse())
    expect(await shelfAttachmentIsLive(userId, ids[0]!)).toBe(true)
    expect(publish).toHaveBeenCalledWith({ userId, revision: result.revision, scopes: ['shelved-drafts'] })
  })
  it('swaps in place and consumes the source exactly once across retries', async () => {
    const first = randomUUID(), second = randomUUID(), replacement = randomUUID(), operationId = randomUUID()
    await save('first', [], first); await save('second', [], second)
    const action: ShelfMutation['action'] = { type: 'restore', id: first, replacement: { id: replacement, content: 'outgoing', attachmentIds: [] } }
    const once = await mutate(action, operationId)
    const twice = await mutate(action, operationId)
    expect(once.drafts.map((d) => d.id)).toEqual([second, replacement])
    expect(twice).toEqual(once)
    expect((await save('late retry', [], first)).drafts.map((d) => d.id)).toEqual([second, replacement])
  })
  it('serializes concurrent saves and relative moves without losing either draft', async () => {
    const a = randomUUID(), b = randomUUID()
    await Promise.all([save('a', [], a), save('b', [], b)])
    const result = await mutate({ type: 'reorder', id: a, targetId: b, edge: 'before' })
    expect(result.drafts.map((d) => d.id)).toEqual([a, b])
    const unchanged = await mutate({ type: 'reorder', id: a, targetId: randomUUID(), edge: 'after' })
    expect(unchanged.drafts.map((d) => d.id)).toEqual([a, b])
  })
  it('does not resurrect an ID deleted before an offline create arrives', async () => {
    const id = randomUUID()
    await mutate({ type: 'delete', id })
    expect((await save('late', [], id)).drafts).toEqual([])
  })
  it('rejects unavailable/foreign attachments without clearing the source or adding a replacement', async () => {
    const source = randomUUID(), replacement = randomUUID()
    await save('keep me', [], source)
    await expect(mutate({ type: 'restore', id: source, replacement: { id: replacement, content: 'bad', attachmentIds: [randomUUID()] } })).rejects.toMatchObject({ code: 'attachment_unavailable' })
    const [row] = await db.select().from(shelvedDrafts).where(eq(shelvedDrafts.id, source))
    expect(row?.deletedAt).toBeNull()
    expect(await db.select().from(shelvedDrafts).where(eq(shelvedDrafts.id, replacement))).toEqual([])
  })
  it('keeps other accounts isolated and releases only the deleted shelf reference', async () => {
    const id = randomUUID()
    await db.insert(attachments).values({ id, userId, originalName: 'test.txt', mimeType: 'text/plain', sizeBytes: 2, objectKey: id, status: 'ready' })
    const a = randomUUID(), b = randomUUID()
    await save('', [id], a); await save('', [id], b)
    expect(await shelfAttachmentIsLive(randomUUID(), id)).toBe(false)
    await mutate({ type: 'delete', id: a })
    expect(await shelfAttachmentIsLive(userId, id)).toBe(true)
    await mutate({ type: 'delete', id: b })
    expect(await shelfAttachmentIsLive(userId, id)).toBe(false)
    expect(await db.select().from(shelvedDrafts).where(and(eq(shelvedDrafts.userId, userId), eq(shelvedDrafts.id, a)))).toHaveLength(1)
  })
  it('keeps shelf attachments account-owned when their former chat is purged', async () => {
    const chatId = randomUUID(), id = randomUUID(), providerId = randomUUID(), modelId = randomUUID()
    await db.insert(providerConnections).values({ id: providerId, name: 'Shelf test', encryptedApiKey: 'unused' })
    await db.insert(models).values({ id: modelId, providerConnectionId: providerId, name: 'Shelf test', upstreamModelId: 'unused', contextWindow: 4096, maxOutputTokens: 1024 })
    await db.insert(chats).values({ id: chatId, userId, modelId, title: 'Former owner' })
    await db.insert(attachments).values({ id, userId, chatId, originalName: 'test.txt', mimeType: 'text/plain', sizeBytes: 2, objectKey: id, status: 'ready' })
    await save('keep file', [id])
    await db.delete(chats).where(eq(chats.id, chatId))
    const [file] = await db.select().from(attachments).where(eq(attachments.id, id))
    expect(file?.chatId).toBeNull()
    expect(file?.shelvedAt).toBeInstanceOf(Date)
    expect(await shelfAttachmentIsLive(userId, id)).toBe(true)
  })
})
