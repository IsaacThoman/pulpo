import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FileAccessMode } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { chats, fileNodes, models, providerConnections, responses, users } from '../../database/schema.js'
import { getBlobStore } from '../../storage/index.js'
import { createDoc } from '../doc-store.js'
import { createFolder } from '../tree-service.js'
import { createFilesRelay, type FilesWorkspace } from './relay.js'

/**
 * Shared setup for the agent Files PostgreSQL tests. Test files mock `../../storage/index.js`
 * with `memoryBlobStore` (see test-blob-store.ts), plus the Redis-backed event modules.
 */

async function readAll(body: Uint8Array | NodeJS.ReadableStream): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body)
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** A workspace whose files live in a Map, like the daemon's /workspace. */
export function memoryWorkspace(): FilesWorkspace & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    async writeWorkspaceFile(path, body, sizeBytes) {
      const bytes = await readAll(body)
      if (bytes.byteLength !== sizeBytes) throw new Error('Size mismatch')
      files.set(path, bytes)
    },
    async readWorkspaceFile(path, maxBytes) {
      const bytes = files.get(path)
      if (!bytes) throw new Error(`${path} does not exist`)
      if (bytes.byteLength > maxBytes) throw new Error(`${path} is larger than the ${maxBytes} byte limit`)
      return bytes
    },
  }
}

export function requireDisposableDatabase(): void {
  if (!process.env.DATABASE_URL?.endsWith('/pulpo_files_test')) throw new Error('Use the disposable pulpo_files_test database')
}

let modelId: string | undefined

async function fixtureModel(): Promise<string> {
  if (modelId) return modelId
  const providerId = randomUUID()
  const id = `files-agent-${providerId}`
  await db.insert(providerConnections).values({ id: providerId, name: 'Files agent fixture', encryptedApiKey: 'unused' })
  await db.insert(models).values({ id, providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Files agent fixture', contextWindow: 16_384, maxOutputTokens: 2_048 })
  modelId = id
  return id
}

/** One user with a chat and an agent reply in it, and helpers to fill Files and talk to the relay. */
export async function filesFixture(options: { storageLimitBytes?: number } = {}) {
  const userId = randomUUID()
  const chatId = randomUUID()
  const model = await fixtureModel()
  await db.insert(users).values({
    id: userId, name: 'Agent files test', email: `${userId}@example.test`, username: `a${userId.replaceAll('-', '')}`, role: 'user',
    storageLimitBytes: options.storageLimitBytes ?? 10_000_000,
  })
  await db.insert(chats).values({ id: chatId, userId, modelId: model })
  const workspace = memoryWorkspace()
  const changes: number[] = []

  const fixture = {
    userId,
    chatId,
    responseId: '',
    workspace,
    /** Counts the relay announced after changes, newest last. */
    changes,
    /** Starts another agent reply in the chat; `relay` talks for it from then on. */
    async newReply(status: 'in_progress' | 'completed' = 'completed') {
      const responseId = randomUUID()
      await db.insert(responses).values({ id: responseId, chatId, userId, modelId: model, input: [], status })
      fixture.responseId = responseId
      return responseId
    },
    async attach(entries: Record<string, FileAccessMode | undefined>) {
      const access = Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, FileAccessMode] => Boolean(entry[1])))
      await db.update(chats).set({ fileScopeIds: Object.keys(entries), fileScopeAccess: access }).where(eq(chats.id, chatId))
    },
    async relay(command: string, args: unknown) {
      const handler = createFilesRelay({
        userId, chatId, responseId: fixture.responseId, workspace, maxOutputBytes: 50_000,
        onChanged: (count) => { changes.push(count) },
      })
      return handler('operation', { id: randomUUID(), command, args })
    },
    /** Runs a command that must succeed and returns its result. */
    async ok(command: string, args: unknown): Promise<{ output: string; data?: unknown }> {
      const result = await fixture.relay(command, args)
      if (!result.ok) throw new Error(`${command} failed: ${result.error}`)
      return result
    },
    async error(command: string, args: unknown): Promise<string> {
      const result = await fixture.relay(command, args)
      if (result.ok) throw new Error(`${command} unexpectedly succeeded: ${result.output}`)
      return result.error
    },
    async folder(name: string, parentId: string | null = null) {
      return (await createFolder(userId, { parentId, name })).id
    },
    async doc(name: string, parentId: string | null, markdown: string) {
      return (await createDoc(userId, { parentId, name, markdown })).id
    },
    async blob(name: string, parentId: string | null, content: string | Buffer, mimeType = 'text/plain') {
      const id = randomUUID()
      const bytes = Buffer.from(content)
      const objectKey = `users/${userId}/files/${id}`
      await getBlobStore().put(objectKey, bytes, { contentType: mimeType, contentLength: bytes.byteLength })
      await db.insert(fileNodes).values({
        id, ownerUserId: userId, parentId, kind: 'blob', name, mimeType, sizeBytes: bytes.byteLength, objectKey,
        checksum: createHash('sha256').update(bytes).digest('base64url'),
      })
      return id
    },
    async node(id: string) {
      const [row] = await db.select().from(fileNodes).where(eq(fileNodes.id, id))
      return row
    },
    /** What an uploaded file holds now. */
    async content(id: string) {
      const row = await fixture.node(id)
      return row?.objectKey ? Buffer.from(await getBlobStore().get(row.objectKey)).toString() : undefined
    },
    /** Puts a file into the workspace. */
    put(path: string, content: string | Buffer) {
      workspace.files.set(path, Buffer.from(content))
    },
  }
  await fixture.newReply()
  return fixture
}

export type FilesFixture = Awaited<ReturnType<typeof filesFixture>>
