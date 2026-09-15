import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }))
vi.mock('../database/client.js', () => ({ get db() { return fixture.db } }))
vi.mock('../config.js', () => ({ getConfig: () => ({ WORKSPACE_CONTROLLER_URL: 'https://controller.invalid', WORKSPACE_CONTROLLER_TOKEN: 'test' }) }))
vi.mock('./controller-http.js', () => ({ workspaceControllerRequest: vi.fn() }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ getStream: async (key: string) => Readable.from([key]) }) }))

import { applicationSettings, attachments, requestLogs, responses, workspaceLeases } from '../database/schema.js'
import { WorkspaceManager } from './controller.js'
import { releaseFinishedWorkspaces, releaseWorkspaceForChat, releaseWorkspaceForResponse } from './workspace-lifecycle.js'
import { workspaceControllerRequest } from './controller-http.js'

const enabled = process.env.PULPO_WORKSPACE_POSTGRES_TEST === '1'
const url = process.env.DATABASE_URL ?? ''
if (enabled && new URL(url).pathname !== '/pulpo_workspace_test') throw new Error('Use the disposable pulpo_workspace_test database')
const schemaName = `workspace_test_${randomUUID().replaceAll('-', '')}`
let client: ReturnType<typeof postgres>
const controller = vi.mocked(workspaceControllerRequest)
const files = new Map<string, Map<string, string>>()
const userId = randomUUID(), chatId = randomUUID()

describe.skipIf(!enabled)('response workspace isolation with PostgreSQL', () => {
  beforeAll(async () => {
    client = postgres(url, { max: 1, prepare: false, onnotice: () => undefined })
    await client.unsafe(`CREATE SCHEMA "${schemaName}"`)
    await client.unsafe(`SET search_path TO "${schemaName}"`)
    fixture.db = drizzle(client)
    // Build only the tables this integration exercises. Use production column
    // types, with enum columns as text; unrelated tables/extensions are unnecessary.
    for (const table of [responses, workspaceLeases, attachments, applicationSettings, requestLogs]) {
      const config = getTableConfig(table)
      const columns = config.columns.map((column) => {
        const type = column.enumValues ? 'text' : column.getSQLType()
        const timestampDefault = ['created_at', 'updated_at'].includes(column.name) ? ' DEFAULT now()' : ''
        return `"${column.name}" ${type}${column.primary ? ' PRIMARY KEY' : ''}${timestampDefault}`
      })
      await client.unsafe(`CREATE TABLE "${config.name}" (${columns.join(', ')})`)
    }
    await client.unsafe(`CREATE UNIQUE INDEX workspace_leases_chat_active_unique ON workspace_leases (chat_id) WHERE status IN ('provisioning', 'ready')`)
    const migration = await readFile(new URL('../../drizzle/0079_response_scoped_workspaces.sql', import.meta.url), 'utf8')
    await client.unsafe(migration.replaceAll('--> statement-breakpoint', '\n'))
  })
  afterAll(async () => {
    if (!client) return
    await client.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
    await client.end()
  })
  beforeEach(async () => {
    await client.unsafe('TRUNCATE workspace_leases, responses, attachments, request_logs, application_settings')
    files.clear()
    controller.mockReset().mockImplementation(async (path, init) => {
      if (path === '/v1/capacity-reservations') return Response.json({ id: randomUUID() })
      if (path.startsWith('/v1/capacity-reservations/')) return Response.json({})
      if (path === '/v1/leases') {
        const id = randomUUID(); files.set(id, new Map())
        return Response.json({ id })
      }
      const match = /^\/v1\/leases\/([^/]+)(.*)$/.exec(path)!
      const [, id, suffix] = match
      if (!suffix && init?.method === 'DELETE') { files.delete(id!); return Response.json({}) }
      const workspace = files.get(id!)
      if (!workspace) return new Response('Missing lease', { status: 404 })
      if (suffix === '/v1/files/missing') {
        const body = JSON.parse(String(init?.body)) as { files: Array<{ path: string }> }
        return Response.json({ missing: body.files.map((file) => file.path) })
      }
      const filePath = new URL(path, 'https://controller.invalid').searchParams.get('path')!
      if (init?.method === 'PUT') {
        let bytes = ''
        for await (const chunk of init.body as Readable) bytes += chunk
        workspace.set(filePath, bytes)
        return Response.json({})
      }
      return new Response(workspace.get(filePath) ?? '', { status: workspace.has(filePath) ? 200 : 404 })
    })
  })

  async function turn(parentResponseId: string | null = null, input: unknown[] = [], output: unknown[] = []) {
    const id = randomUUID()
    await fixture.db.insert(responses).values({ id, chatId, userId, modelId: 'test', parentResponseId, input, output, status: 'in_progress' })
    return id
  }
  const manager = (id: string) => new WorkspaceManager(id, chatId, userId)

  it('keeps tool calls and recovery together but isolates follow-ups and regenerated siblings', async () => {
    const first = await turn()
    const original = manager(first)
    const firstLease = await original.ensureLease()
    files.get(firstLease)!.set('/workspace/scratch.txt', 'old workspace')
    expect(await original.ensureLease()).toBe(firstLease)
    expect(await manager(first).ensureLease()).toBe(firstLease)
    const followUp = await turn(first)
    const regenerate = await turn()
    const [followUpLease, regeneratedLease] = await Promise.all([manager(followUp).ensureLease(), manager(regenerate).ensureLease()])
    expect(new Set([firstLease, followUpLease, regeneratedLease]).size).toBe(3)
    expect(files.get(followUpLease)!.has('/workspace/scratch.txt')).toBe(false)
    expect(files.get(regeneratedLease)!.has('/workspace/scratch.txt')).toBe(false)
    // The migration permits concurrent branches but still enforces one active lease per response.
    await expect(fixture.db.insert(workspaceLeases).values({ id: randomUUID(), responseId: first, chatId, userId, status: 'ready', imageDigest: 'test' })).rejects.toThrow()
  })

  it('restores only saved attachments on the selected branch, with the latest file revision', async () => {
    const upload = randomUUID(), oldResult = randomUUID(), editedResult = randomUUID(), siblingResult = randomUUID()
    const attached = (id: string) => [{ type: 'pulpo_attachment', attachment_id: id }]
    const parent = await turn(null, [{ role: 'user', content: [{ type: 'input_file', attachment_id: upload }] }], attached(oldResult))
    await turn(parent, [], attached(siblingResult))
    const edit = await turn(parent, [], attached(editedResult))
    const followUp = await turn(edit)
    for (const [index, id] of [upload, oldResult, editedResult, siblingResult].entries()) {
      await fixture.db.insert(attachments).values({ id, chatId, userId, status: 'ready', objectKey: id, originalName: 'file.txt',
        mimeType: 'text/plain', sizeBytes: id.length, origin: id === upload ? 'user' : 'assistant',
        workspacePath: id === siblingResult ? '/workspace/sibling.txt' : '/workspace/report.txt',
        createdAt: new Date(1000 + index),
      })
    }
    const leaseId = await manager(followUp).ensureLease()
    expect([...files.get(leaseId)!.values()]).toEqual([upload, editedResult])
    expect(files.get(leaseId)!.get('/workspace/report.txt')).toBe(editedResult)
    expect(files.get(leaseId)!.has('/workspace/sibling.txt')).toBe(false)
  })

  it('restricts image recovery to the original response and releases all branches when deleting a chat', async () => {
    const first = await turn(), sibling = await turn()
    const firstLease = await manager(first).ensureLease(), siblingLease = await manager(sibling).ensureLease()
    files.get(firstLease)!.set('/workspace/image.png', 'image bytes')
    expect(await manager(first).readGeneratedFile('/workspace/image.png', firstLease)).toMatchObject({ sizeBytes: 11 })
    await expect(manager(sibling).readGeneratedFile('/workspace/image.png', firstLease)).rejects.toThrow('original image workspace')
    await releaseWorkspaceForResponse(first)
    expect(files.has(firstLease)).toBe(false)
    expect(files.has(siblingLease)).toBe(true)
    await releaseWorkspaceForChat(chatId)
    expect(files.size).toBe(0)
    expect((await fixture.db.select().from(workspaceLeases)).every((row) => row.status === 'released')).toBe(true)
  })

  it.each(['completed', 'failed', 'cancelled', 'incomplete'] as const)('retries disposal of a %s response only after final accounting, without touching active responses', async (status) => {
    const finished = await turn(), active = await turn()
    const finishedLease = await manager(finished).ensureLease(), activeLease = await manager(active).ensureLease()
    await fixture.db.update(responses).set({ status }).where(eq(responses.id, finished))
    await fixture.db.insert(requestLogs).values({ id: randomUUID(), responseId: finished, userId, requestedModelId: 'test', completedAt: null })
    await releaseFinishedWorkspaces()
    expect(files.has(finishedLease)).toBe(true)
    await fixture.db.update(requestLogs).set({ completedAt: new Date() }).where(eq(requestLogs.responseId, finished))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    controller.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    await releaseWorkspaceForResponse(finished)
    expect((await fixture.db.select().from(workspaceLeases).where(eq(workspaceLeases.responseId, finished)))[0]!.releasedAt).toBeNull()
    await releaseFinishedWorkspaces()
    expect(files.has(finishedLease)).toBe(false)
    expect(files.has(activeLease)).toBe(true)
    warn.mockRestore()
  })
})
