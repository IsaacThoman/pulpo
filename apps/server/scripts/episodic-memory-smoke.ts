import { and, eq, ne } from 'drizzle-orm'
import { db, queryClient } from '../src/database/client.js'
import {
  applicationSettings,
  chats,
  chatTurnEmbeddings,
  episodicMemoryGenerations,
  models,
  providerConnections,
  responses,
  userMemoryDocuments,
  userPreferences,
  users,
} from '../src/database/schema.js'
import { processEmbeddingJob } from '../src/episodic-memory/processor.js'
import { searchEpisodicChats } from '../src/episodic-memory/retrieval.js'
import type { OllamaClient } from '../src/episodic-memory/ollama.js'
import { readEpisodicChatPage } from '../src/episodic-memory/agent-tools.js'
import { recalledChatContext, retrieveAutomaticRecall } from '../src/episodic-memory/automatic-recall.js'
import { embeddingQueue } from '../src/jobs.js'

if (process.env.PULPO_EPISODIC_SMOKE !== '1') {
  throw new Error('Set PULPO_EPISODIC_SMOKE=1 and use a disposable database before running this script')
}

const ids = {
  user: '10000000-0000-4000-8000-000000000001',
  provider: '20000000-0000-4000-8000-000000000001',
  chat: '30000000-0000-4000-8000-000000000001',
  destinationChat: '30000000-0000-4000-8000-000000000002',
  root: '40000000-0000-4000-8000-000000000001',
  originalLeaf: '40000000-0000-4000-8000-000000000002',
  alternateLeaf: '40000000-0000-4000-8000-000000000003',
} as const

function visibleOutput(text: string, hidden: string): unknown[] {
  return [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: hidden }] },
    { type: 'function_call', name: 'workspace_read', output: hidden },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] },
  ]
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function resetAndSeed(): Promise<void> {
  await db.delete(users).where(eq(users.id, ids.user))
  await db.delete(models).where(eq(models.id, 'episodic-smoke-model'))
  await db.delete(providerConnections).where(eq(providerConnections.id, ids.provider))
  await db.delete(episodicMemoryGenerations)
  await db.delete(applicationSettings).where(eq(applicationSettings.key, 'episodicMemory'))

  await db.insert(users).values({
    id: ids.user,
    email: 'episodic-smoke@pulpo.invalid',
    name: 'Episodic Smoke',
    username: 'episodic-smoke',
    role: 'admin',
  })
  await db.insert(userPreferences).values({ userId: ids.user, values: { memoryEnabled: true } })
  await db.insert(providerConnections).values({
    id: ids.provider,
    name: 'Episodic smoke provider',
    encryptedApiKey: 'not-used-by-episodic-smoke',
  })
  await db.insert(models).values({
    id: 'episodic-smoke-model',
    providerConnectionId: ids.provider,
    upstreamModelId: 'episodic-smoke-model',
    name: 'Episodic smoke model',
    contextWindow: 16_384,
    maxOutputTokens: 2_048,
  })
  await db.insert(chats).values([
    {
      id: ids.chat,
      userId: ids.user,
      modelId: 'episodic-smoke-model',
      title: 'Garden planning notes',
      activeResponseId: ids.originalLeaf,
      activeBranchLeafId: ids.originalLeaf,
    },
    {
      id: ids.destinationChat,
      userId: ids.user,
      modelId: 'episodic-smoke-model',
      title: 'Destination chat',
    },
  ])
  await db.insert(responses).values([
    {
      id: ids.root,
      chatId: ids.chat,
      userId: ids.user,
      modelId: 'episodic-smoke-model',
      actualModelId: 'episodic-smoke-model',
      userMessageId: '60000000-0000-4000-8000-000000000001',
      status: 'completed',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'I planted hibiscus beside the south fence.' }, { type: 'input_file', attachment_id: 'never-index-this-attachment' }] }],
      output: visibleOutput('Hibiscus prefers the sunny side of that fence.', 'SECRET_REASONING_AND_TOOL_OUTPUT'),
      completedAt: new Date('2026-08-20T12:00:00.000Z'),
      createdAt: new Date('2026-08-20T12:00:00.000Z'),
    },
    {
      id: ids.originalLeaf,
      chatId: ids.chat,
      userId: ids.user,
      modelId: 'episodic-smoke-model',
      actualModelId: 'episodic-smoke-model',
      parentResponseId: ids.root,
      previousResponseId: ids.root,
      userMessageId: '60000000-0000-4000-8000-000000000002',
      status: 'completed',
      input: [{ role: 'user', content: 'Remind me which tea the flowers make.' }],
      output: visibleOutput('The flowers can be dried for tart hibiscus tea.', 'ANOTHER_PRIVATE_TRACE'),
      completedAt: new Date('2026-08-21T12:00:00.000Z'),
      createdAt: new Date('2026-08-21T12:00:00.000Z'),
    },
    {
      id: ids.alternateLeaf,
      chatId: ids.chat,
      userId: ids.user,
      modelId: 'episodic-smoke-model',
      actualModelId: 'episodic-smoke-model',
      parentResponseId: ids.root,
      previousResponseId: ids.originalLeaf,
      userMessageId: '60000000-0000-4000-8000-000000000003',
      branchReason: 'user_edit',
      status: 'completed',
      input: [{ role: 'user', content: 'How should I glaze the ceramic planters?' }],
      output: visibleOutput('Use a frost-safe ceramic glaze for outdoor planters.', 'INACTIVE_BRANCH_SECRET'),
      completedAt: new Date('2026-08-22T12:00:00.000Z'),
      createdAt: new Date('2026-08-22T12:00:00.000Z'),
    },
  ])
  await db.insert(userMemoryDocuments).values({
    userId: ids.user,
    content: '# About me\n\n- I garden in a cold climate.',
    revision: 1,
    lastEditor: 'user',
    editSummary: 'Created smoke-test profile',
  })
  await db.insert(applicationSettings).values({
    key: 'episodicMemory',
    value: { enabled: true, profile: 'embeddinggemma', recallMode: 'balanced' },
    updatedBy: ids.user,
  })
}

async function verifyGeneration(profile: 'embeddinggemma' | 'qwen3-embedding', dimension: number): Promise<void> {
  const generations = await db.select().from(episodicMemoryGenerations)
  const active = generations.find((generation) => generation.active)
  assert(active?.profile === profile, `${profile} was not activated`)
  assert(active.status === 'ready' && active.dimension === dimension && active.modelDigest, `${profile} metadata is incomplete`)
  const chunks = await db.select().from(chatTurnEmbeddings).where(eq(chatTurnEmbeddings.generationId, active.id))
  assert(chunks.length === 2, `expected two active-lineage chunks, received ${chunks.length}`)
  assert(chunks.every((chunk) => chunk.status === 'ready' && chunk.embedding?.length === dimension), 'chat vectors are incomplete')
  assert(chunks.every((chunk) => !chunk.chunkText.includes('SECRET') && !chunk.chunkText.includes('attachment')), 'private response data reached a chunk')
}

async function main(): Promise<void> {
  await resetAndSeed()
  await processEmbeddingJob({ type: 'reconcile', force: true })
  await verifyGeneration('embeddinggemma', 768)

  const initial = await searchEpisodicChats({
    userId: ids.user,
    currentChatId: ids.destinationChat,
    query: 'hibiscus tea',
  })
  assert(initial[0]?.chatId === ids.chat, 'hybrid retrieval did not return the source chat')

  await db.update(chats).set({ activeResponseId: ids.alternateLeaf, activeBranchLeafId: ids.alternateLeaf })
    .where(eq(chats.id, ids.chat))
  await processEmbeddingJob({ type: 'index-chat', chatId: ids.chat, userId: ids.user })
  const active = (await db.select().from(episodicMemoryGenerations)).find((generation) => generation.active)!
  const branchRows = await db.select({ responseId: chatTurnEmbeddings.responseId }).from(chatTurnEmbeddings)
    .where(and(eq(chatTurnEmbeddings.generationId, active.id), eq(chatTurnEmbeddings.chatId, ids.chat)))
  assert(branchRows.some((row) => row.responseId === ids.alternateLeaf), 'active branch was not indexed')
  assert(branchRows.every((row) => row.responseId !== ids.originalLeaf), 'inactive branch vector was retained')

  await db.update(applicationSettings).set({
    value: { enabled: true, profile: 'qwen3-embedding', recallMode: 'balanced' },
  }).where(eq(applicationSettings.key, 'episodicMemory'))
  await processEmbeddingJob({ type: 'reconcile' })
  await verifyGeneration('qwen3-embedding', 1_024)
  const [activeAfterSwitch] = await db.select().from(episodicMemoryGenerations)
    .where(eq(episodicMemoryGenerations.active, true)).limit(1)
  const obsoleteRows = await db.select({ id: chatTurnEmbeddings.id }).from(chatTurnEmbeddings)
    .where(ne(chatTurnEmbeddings.generationId, activeAfterSwitch!.id))
  assert(obsoleteRows.length === 0, 'old generation vectors were not removed after activation')

  const failingClient = { embed: async () => { throw new Error('intentional smoke-test outage') } } as OllamaClient
  const lexical = await searchEpisodicChats({
    userId: ids.user,
    currentChatId: ids.destinationChat,
    query: 'ceramic glaze',
  }, failingClient)
  assert(lexical[0]?.chatId === ids.chat, 'lexical fallback did not return the source chat')
  const transcript = await readEpisodicChatPage({
    userId: ids.user,
    currentChatId: ids.destinationChat,
    chatId: ids.chat,
    maxOutputBytes: 10_000,
  })
  assert(transcript?.turns.length === 2, 'read_chat did not return the active lineage')
  assert(!JSON.stringify(transcript).includes('SECRET'), 'read_chat exposed hidden response content')
  const excludedCurrent = await readEpisodicChatPage({
    userId: ids.user,
    currentChatId: ids.chat,
    chatId: ids.chat,
    maxOutputBytes: 10_000,
  })
  assert(excludedCurrent === null, 'read_chat did not exclude the current chat')
  const automaticRecall = await retrieveAutomaticRecall({
    responseId: '70000000-0000-4000-8000-000000000001',
    userId: ids.user,
    currentChatId: ids.destinationChat,
    query: 'Which glaze did we choose for the ceramic planters?',
  })
  assert(automaticRecall?.sources[0]?.chat_id === ids.chat, 'automatic recall did not return the source chat')
  const automaticContext = recalledChatContext(automaticRecall)
  assert(automaticContext.includes('untrusted reference material'), 'automatic recall context was not marked untrusted')
  assert(!automaticContext.includes('SECRET'), 'automatic recall exposed hidden response content')

  await db.update(userPreferences).set({ values: { memoryEnabled: false } }).where(eq(userPreferences.userId, ids.user))
  await processEmbeddingJob({ type: 'delete-user', userId: ids.user })
  const [chatVectors, memoryDocuments] = await Promise.all([
    db.select().from(chatTurnEmbeddings).where(eq(chatTurnEmbeddings.userId, ids.user)),
    db.select().from(userMemoryDocuments).where(eq(userMemoryDocuments.userId, ids.user)),
  ])
  assert(chatVectors.length === 0, 'user opt-out did not delete derived chat vectors')
  assert(memoryDocuments.length === 1, 'user opt-out deleted MEMORY.md')

  console.info(JSON.stringify({
    ok: true,
    initialProfile: 'embeddinggemma',
    switchedProfile: 'qwen3-embedding',
    hybridTopChatId: initial[0]?.chatId,
    lexicalFallbackTopChatId: lexical[0]?.chatId,
    automaticRecallSources: automaticRecall.sources.length,
    memoryDocumentsRetainedAfterOptOut: memoryDocuments.length,
  }))
}

try {
  await main()
} finally {
  await Promise.all([queryClient.end(), embeddingQueue.disconnect()])
}
process.exit(0)
