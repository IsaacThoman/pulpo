import { Worker } from 'bullmq'
import { inArray } from 'drizzle-orm'
import { getConfig } from './config.js'
import { db } from './database/client.js'
import { responses } from './database/schema.js'
import { generationQueue, type GenerationJob } from './jobs.js'
import { processGeneration } from './responses/worker.js'

const config = getConfig()
console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'worker.started', environment: config.NODE_ENV }))

const generationWorker = new Worker<GenerationJob>('generation', async (job) => {
  const attempts = job.opts.attempts ?? 1
  await processGeneration(job.data.responseId, {
    willRetry: job.attemptsMade + 1 < attempts,
  })
}, {
  connection: { url: config.REDIS_URL },
  concurrency: 4,
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
  .where(inArray(responses.status, ['queued', 'in_progress']))
for (const response of recoverable) {
  const existing = await generationQueue.getJob(response.id)
  if (!existing) await generationQueue.add('recover', { responseId: response.id }, { jobId: response.id })
}

const shutdown = async (signal: string) => {
  console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'worker.stopping', signal }))
  await generationWorker.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
