import { Queue } from 'bullmq'
import { getConfig } from './config.js'

export interface GenerationJob {
  responseId: string
}

export interface CodexLoginJob {
  attemptId: string
}

export interface MaintenanceJob {
  type: 'cleanup' | 'scrub-response-binary-context' | 'purge-chats' | 'expire-temporary-chat' | 'expire-normal-chat' | 'rollup' | 'export' | 'backup' | 'restore' | 'billing-reconcile'
  payload?: Record<string, unknown>
}

export type EmbeddingJob =
  | { type: 'reconcile'; force?: boolean }
  | { type: 'index-chat'; chatId: string; userId: string }
  | { type: 'index-user'; userId: string }
  | { type: 'delete-user'; userId: string }

const connection = { url: getConfig().REDIS_URL }

export const generationQueue = new Queue<GenerationJob>('generation', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
})

export const codexLoginQueue = new Queue<CodexLoginJob>('codex-login', {
  connection,
  defaultJobOptions: { attempts: 1, removeOnComplete: 1_000, removeOnFail: 5_000 },
})

export const maintenanceQueue = new Queue<MaintenanceJob>('maintenance', { connection })

export const embeddingQueue = new Queue<EmbeddingJob>('episodic-memory', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
})
