// Has an agent reply suggest a new version of a live document, the way `pulpo files push` does in
// a chat with the file attached in Suggest mode (or, with `write`, Edit mode, applying it right away).
// Used by the web's live-text and live-sheets browser tests, against a local disposable database only:
//   tsx scripts/seed-live-suggestion.ts <chatId> <responseId> <fileId> <path-to-new-version> [suggest|write]
import { readFile } from 'node:fs/promises'
import { and, eq } from 'drizzle-orm'
import { db, queryClient } from '../src/database/client.js'
import { chats, fileNodes, responses } from '../src/database/schema.js'
import { createFilesRelay, type FilesWorkspace } from '../src/files/agent/relay.js'

const [chatId, responseId, fileId, source, mode = 'suggest'] = process.argv.slice(2)
if (!chatId || !responseId || !fileId || !source || (mode !== 'suggest' && mode !== 'write')) throw new Error('Usage: seed-live-suggestion.ts <chatId> <responseId> <fileId> <file> [suggest|write]')
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) throw new Error('Seed only a local database.')

const [chat] = await db.select().from(chats).where(eq(chats.id, chatId))
const [file] = await db.select().from(fileNodes).where(and(eq(fileNodes.id, fileId), eq(fileNodes.ownerUserId, chat!.userId)))
if (!chat || !file) throw new Error('No such chat or file for its owner')
await db.update(chats).set({ fileScopeIds: [fileId], fileScopeAccess: { [fileId]: mode } }).where(eq(chats.id, chatId))

const bytes = await readFile(source)
const workspace: FilesWorkspace = {
  async writeWorkspaceFile() {},
  async readWorkspaceFile() { return bytes },
}
const relay = createFilesRelay({ userId: chat.userId, chatId, responseId, workspace, maxOutputBytes: 50_000 })
const result = await relay('seed', { id: 'seed', command: 'push', args: { items: [{ local: '/workspace/new', remote: file.name, base: null, force: true }] } })
console.log(JSON.stringify(result))
// The reply announces it changed Files, as the agent runner does after a push.
const [response] = await db.select({ output: responses.output }).from(responses).where(eq(responses.id, responseId))
const output = (response!.output as unknown[]).filter((item) => (item as { type?: string }).type !== 'pulpo_file_changes')
await db.update(responses).set({ output: [...output, { type: 'pulpo_file_changes', id: 'file-changes', count: 1 }] }).where(eq(responses.id, responseId))
await queryClient.end()
// The relay published its changes through Redis, whose client would keep the process alive.
process.exit(0)
