// Simulates an agent reply that works with Files, for the acceptance runs: it creates a chat
// with a finished agent reply for the Files acceptance account, attaches Files items to the chat,
// and runs real `pulpo files` commands through the server's relay with an in-memory workspace,
// as the agent's sandbox would. The reply then carries a `pulpo_file_changes` item, and the
// changes it made are real rows the app reviews, accepts, rejects, undoes, and redoes.
//
// Run from the repository root with the backend's environment (see files-validation.md), after
// files-seed.mjs. It only runs against the disposable pulpo_mobile_files database.
//   node apps/mobile/e2e/files-agent.mjs
import { randomUUID } from 'node:crypto'

if (process.env.POSTGRES_DATABASE !== 'pulpo_mobile_files') throw new Error('Use POSTGRES_DATABASE=pulpo_mobile_files')
const { db, queryClient } = await import('../../server/dist/database/client.js')
const { chats, fileNodes, models, providerConnections, responses, users } = await import('../../server/dist/database/schema.js')
const { createFilesRelay } = await import('../../server/dist/files/agent/relay.js')
const { memoryWorkspace } = await import('../../server/dist/files/agent/test-fixtures.js')
const { and, eq, isNull } = await import('drizzle-orm')

const [user] = await db.select().from(users).where(eq(users.email, 'files@example.test'))
if (!user) throw new Error('Run files-seed.mjs first')

let [model] = await db.select().from(models).where(eq(models.id, 'files-agent-e2e'))
if (!model) {
  const providerId = randomUUID()
  await db.insert(providerConnections).values({ id: providerId, name: 'Files agent e2e', encryptedApiKey: 'unused' })
  await db.insert(models).values({ id: 'files-agent-e2e', providerConnectionId: providerId, upstreamModelId: 'fixture', name: 'Files Agent', contextWindow: 16_384, maxOutputTokens: 2_048, visible: false })
  ;[model] = await db.select().from(models).where(eq(models.id, 'files-agent-e2e'))
}

const nodeNamed = async (name, parentId = null) => {
  const [node] = await db.select().from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, user.id), eq(fileNodes.name, name), isNull(fileNodes.trashedAt),
    parentId ? eq(fileNodes.parentId, parentId) : isNull(fileNodes.parentId),
  ))
  if (!node) throw new Error(`Missing ${name}`)
  return node
}
const projects = await nodeNamed('Projects')
const launch = await nodeNamed('Launch', projects.id)
const ideas = await nodeNamed('Ideas.md')

// A chat whose agent may suggest changes in Projects and edit Ideas.md directly.
const chatId = randomUUID()
const responseId = randomUUID()
const now = new Date()
await db.insert(chats).values({
  id: chatId, userId: user.id, modelId: model.id, title: 'Tidy the launch plan',
  fileScopeIds: [projects.id, ideas.id], fileScopeAccess: { [projects.id]: 'suggest', [ideas.id]: 'write' },
  activeResponseId: responseId, activeBranchLeafId: responseId,
})
await db.insert(responses).values({
  id: responseId, chatId, userId: user.id, modelId: model.id, agentMode: true, status: 'in_progress',
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'Tidy the launch plan and add a summary.' }] }],
})

const workspace = memoryWorkspace()
const relay = createFilesRelay({ userId: user.id, chatId, responseId, workspace, maxOutputBytes: 50_000 })
const run = async (command, args) => {
  const result = await relay(randomUUID(), { id: randomUUID(), command, args })
  if (!result.ok) throw new Error(`${command}: ${result.error}`)
  return result
}

// Suggest: edit Plan.md, add a summary document, and move the announcement up a level.
const pulled = await run('pull', { path: 'Projects/Plan.md', dest: '/workspace/Plan.md' })
const plan = workspace.files.get('/workspace/Plan.md').toString()
workspace.files.set('/workspace/Plan.md', Buffer.from(plan
  .replace('- [ ] Native file browser', '- [x] Native file browser')
  .replace('2. Never lose a keystroke.', '2. Never lose a keystroke.\n3. Review every agent change.')))
const version = pulled.data?.files?.[0]?.version ?? pulled.data?.items?.[0]?.version
const base = version ? { nodeId: (await nodeNamed('Plan.md', projects.id)).id, version } : null
workspace.files.set('/workspace/Summary.md', Buffer.from('# Summary\n\nThe browser shipped; the agent integration is next.\n'))
await run('push', { items: [
  { local: '/workspace/Plan.md', remote: 'Projects/Plan.md', base, force: base === null },
  { local: '/workspace/Summary.md', remote: 'Projects/Summary.md' },
] })
await run('mv', { from: `Projects/${launch.name}/Announcement.md`, to: 'Projects/Announcement.md' })

// Write: append to Ideas.md directly (undoable from the reply).
await run('pull', { path: 'Ideas.md', dest: '/workspace/Ideas.md' })
const ideasText = workspace.files.get('/workspace/Ideas.md').toString()
workspace.files.set('/workspace/Ideas.md', Buffer.from(`${ideasText.trimEnd()}\n- Spotlight results that open documents\n`))
await run('push', { items: [{ local: '/workspace/Ideas.md', remote: 'Ideas.md', force: true }] })

const { countFileChanges } = await import('../../server/dist/files/agent/changes.js')
const count = await countFileChanges(responseId)
await db.update(responses).set({
  status: 'completed',
  completedAt: now,
  output: [
    { type: 'pulpo_tool', id: 'tool-1', tool: 'bash', status: 'completed', arguments: { command: 'pulpo files pull Projects/Plan.md' }, output: 'Pulled 1 file' },
    { type: 'pulpo_tool', id: 'tool-2', tool: 'bash', status: 'completed', arguments: { command: 'pulpo files push Plan.md Summary.md' }, output: 'Suggested 2 files' },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I checked off the browser, added a review step to the plan, wrote a summary, moved the announcement up, and added an idea. The plan and summary are suggestions for you to review; the idea is already in.' }] },
    { type: 'pulpo_file_changes', id: 'file-changes', count },
  ],
}).where(eq(responses.id, responseId))
await db.update(chats).set({ updatedAt: now }).where(eq(chats.id, chatId))
console.log(JSON.stringify({ chatId, responseId, changes: count }))
await queryClient.end()
process.exit(0)
