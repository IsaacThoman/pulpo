import { Worker } from 'bullmq'
import { and, inArray, isNull, eq } from 'drizzle-orm'
import { getConfig } from './config.js'
import { db } from './database/client.js'
import { applicationSettings, chats, responses } from './database/schema.js'
import { generationQueue, maintenanceQueue, type GenerationJob, type MaintenanceJob } from './jobs.js'
import { processGeneration } from './responses/worker.js'
import { createExport, rebuildDailyRollups, runCleanup, scrubPersistedResponseBinaryContext } from './maintenance.js'
import { createFullBackup, restoreFullBackup } from './admin/backup.js'
import { expireTemporaryChat, markExpiredChatsForPurge, purgePendingChats } from './chats/trash.js'
import { parseAgentSettings } from './settings/application-settings.js'
import { accessibleChatCondition } from './chats/temporary.js'
import { advanceMessageQueue, recoverMessageQueues } from './chats/message-queue.js'
import { isTerminalResponseStatus } from './chats/message-queue-policy.js'

const config = getConfig()
const readGenerationConcurrency = async (): Promise<number> => {
  const [row] = await db.select({ value: applicationSettings.value })
    .from(applicationSettings)
    .where(eq(applicationSettings.key, 'agent'))
    .limit(1)
  return parseAgentSettings(row?.value).generationConcurrency
}

const initialGenerationConcurrency = await readGenerationConcurrency()
console.info(JSON.stringify({
  level: 'info', service: 'pulpo-worker', event: 'worker.started',
  environment: config.NODE_ENV, generationConcurrency: initialGenerationConcurrency,
}))

const generationWorker = new Worker<GenerationJob>('generation', async (job) => {
  try {
    await processGeneration(job.data.responseId)
  } finally {
    const [response] = await db.select({ chatId: responses.chatId, status: responses.status })
      .from(responses).where(eq(responses.id, job.data.responseId)).limit(1)
    if (response && isTerminalResponseStatus(response.status)) {
      await advanceMessageQueue(response.chatId)
    }
  }
}, {
  connection: { url: config.REDIS_URL },
  concurrency: initialGenerationConcurrency,
})

const concurrencyRefreshInterval = setInterval(() => {
  void readGenerationConcurrency().then((generationConcurrency) => {
    if (generationConcurrency === generationWorker.concurrency) return
    const previousGenerationConcurrency = generationWorker.concurrency
    generationWorker.concurrency = generationConcurrency
    console.info(JSON.stringify({
      level: 'info', service: 'pulpo-worker', event: 'worker.concurrency_updated',
      previousGenerationConcurrency, generationConcurrency,
    }))
  }).catch((error: unknown) => {
    console.error(JSON.stringify({
      level: 'error', service: 'pulpo-worker', event: 'worker.concurrency_refresh_failed',
      error: error instanceof Error ? error.message : String(error),
    }))
  })
}, 15_000)
concurrencyRefreshInterval.unref()

const maintenanceWorker = new Worker<MaintenanceJob>('maintenance', async (job) => {
  if (job.data.type === 'export') await createExport(String(job.data.payload?.exportId))
  if (job.data.type === 'cleanup') await runCleanup()
  if (job.data.type === 'scrub-response-binary-context') await scrubPersistedResponseBinaryContext()
  if (job.data.type === 'purge-chats') {
    const userId = typeof job.data.payload?.userId === 'string' ? job.data.payload.userId : undefined
    await markExpiredChatsForPurge(new Date(), userId)
    await purgePendingChats(userId)
  }
  if (job.data.type === 'expire-temporary-chat') {
    const chatId = typeof job.data.payload?.chatId === 'string' ? job.data.payload.chatId : ''
    const userId = typeof job.data.payload?.userId === 'string' ? job.data.payload.userId : ''
    if (chatId && userId && await expireTemporaryChat(chatId, userId)) await purgePendingChats(userId)
  }
  if (job.data.type === 'rollup') await rebuildDailyRollups()
  if (job.data.type === 'backup') await createFullBackup(String(job.data.payload?.jobId))
  if (job.data.type === 'restore') await restoreFullBackup(String(job.data.payload?.jobId))
}, { connection: { url: config.REDIS_URL }, concurrency: 1 })

await maintenanceQueue.upsertJobScheduler('payload-cleanup', { every: 15 * 60 * 1_000 }, { name: 'cleanup', data: { type: 'cleanup' } })
await maintenanceQueue.upsertJobScheduler('daily-rollup', { pattern: '15 2 * * *' }, { name: 'rollup', data: { type: 'rollup' } })
await maintenanceQueue.add('startup-cleanup', { type: 'cleanup' }, { jobId: `startup-cleanup-${Date.now()}` })
await maintenanceQueue.add('startup-response-context-scrub', { type: 'scrub-response-binary-context' }, {
  jobId: 'response-context-scrub-v1',
  attempts: 3,
  removeOnFail: true,
})

generationWorker.on('failed', (job, error) => {
  console.error(JSON.stringify({
    level: 'error', service: 'pulpo-worker', event: 'generation.failed',
    responseId: job?.data.responseId, error: error.message,
  }))
})

const recoverable = await db
  .select({ id: responses.id })
  .from(responses)
  .innerJoin(chats, eq(chats.id, responses.chatId))
  .where(and(inArray(responses.status, ['queued', 'in_progress']), isNull(chats.deletedAt), accessibleChatCondition()))
for (const response of recoverable) {
  const existing = await generationQueue.getJob(response.id)
  if (!existing) await generationQueue.add('recover', { responseId: response.id }, { jobId: response.id })
}
await recoverMessageQueues()

const shutdown = async (signal: string) => {
  console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'worker.stopping', signal }))
  clearInterval(concurrencyRefreshInterval)
  await generationWorker.close()
  await maintenanceWorker.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
