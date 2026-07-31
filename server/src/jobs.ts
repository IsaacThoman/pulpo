import { Queue } from 'bullmq'
import { getConfig } from './config.js'

export interface GenerationJob {
  responseId: string
}

export interface MaintenanceJob {
  type: 'cleanup' | 'rollup' | 'export'
  payload?: Record<string, unknown>
}

const connection = { url: getConfig().REDIS_URL }

export const generationQueue = new Queue<GenerationJob>('generation', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
})

export const maintenanceQueue = new Queue<MaintenanceJob>('maintenance', { connection })
