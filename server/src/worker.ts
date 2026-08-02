import { Worker } from 'bullmq'
import { and, inArray, isNull, eq } from 'drizzle-orm'
import { getConfig } from './config.js'
import { db } from './database/client.js'
import { chats, responses } from './database/schema.js'
import { generationQueue, maintenanceQueue, type GenerationJob, type MaintenanceJob } from './jobs.js'
import { processGeneration } from './responses/worker.js'
import { createExport, rebuildDailyRollups, runCleanup } from './maintenance.js'
import { createFullBackup, restoreFullBackup } from './admin/backup.js'
import { markExpiredChatsForPurge, purgePendingChats } from './chats/trash.js'

const config = getConfig()
console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'worker.started', environment: config.NODE_ENV }))

const generationWorker = new Worker<GenerationJob>('generation', async (job) => {
  await processGeneration(job.data.responseId)
}, {
  connection: { url: config.REDIS_URL },
  concurrency: 4,
})

const maintenanceWorker = new Worker<MaintenanceJob>('maintenance', async (job) => {
  if (job.data.type === 'export') await createExport(String(job.data.payload?.exportId))
  if (job.data.type === 'cleanup') await runCleanup()
  if (job.data.type === 'purge-chats') {
    const userId = typeof job.data.payload?.userId === 'string' ? job.data.payload.userId : undefined
    await markExpiredChatsForPurge(new Date(), userId)
    await purgePendingChats(userId)
  }
  if (job.data.type === 'rollup') await rebuildDailyRollups()
  if (job.data.type === 'backup') await createFullBackup(String(job.data.payload?.jobId))
  if (job.data.type === 'restore') await restoreFullBackup(String(job.data.payload?.jobId))
}, { connection: { url: config.REDIS_URL }, concurrency: 1 })

await maintenanceQueue.upsertJobScheduler('payload-cleanup', { every: 15 * 60 * 1_000 }, { name: 'cleanup', data: { type: 'cleanup' } })
await maintenanceQueue.upsertJobScheduler('daily-rollup', { pattern: '15 2 * * *' }, { name: 'rollup', data: { type: 'rollup' } })
await maintenanceQueue.add('startup-cleanup', { type: 'cleanup' }, { jobId: `startup-cleanup-${Date.now()}` })

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
  .where(and(inArray(responses.status, ['queued', 'in_progress']), isNull(chats.deletedAt)))
for (const response of recoverable) {
  const existing = await generationQueue.getJob(response.id)
  if (!existing) await generationQueue.add('recover', { responseId: response.id }, { jobId: response.id })
}

const shutdown = async (signal: string) => {
  console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'worker.stopping', signal }))
  await generationWorker.close()
  await maintenanceWorker.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
