import { Queue } from 'bullmq'
import { getConfig } from './config.js'

export interface GenerationJob {
  responseId: string
}

export interface CodexLoginJob {
  attemptId: string
}

export interface AnalyticsJob {
  type: 'sweep' | 'rollup-recent' | 'rollup-full'
}

export interface MaintenanceJob {
  type: 'delete-account' | 'cleanup' | 'backup-schedule' | 'scrub-response-binary-context' | 'purge-chats' | 'expire-temporary-chat' | 'expire-normal-chat' | 'rollup' | 'export' | 'backup' | 'restore' | 'billing-reconcile' | 'auto-top-up' | 'auto-top-up-sweep'
  payload?: Record<string, unknown>
}

export type EmbeddingJob =
  | { type: 'reconcile'; force?: boolean }
  | { type: 'index-chat'; chatId: string; userId: string }
  | { type: 'index-user'; userId: string }
  | { type: 'delete-user'; userId: string }

export interface FileDocJob {
  nodeId: string
}

export interface FileRecordingJob {
  clipId: string
}

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

/**
 * Purges the account's trash now: chats marked for purging, and chats and Files items past the
 * retention setting. (The job keeps its original name so jobs queued before upgrades still run.)
 */
export async function queueTrashPurge(userId: string, reason: string): Promise<void> {
  await maintenanceQueue.add('purge-chats', { type: 'purge-chats', payload: { userId } }, {
    jobId: `purge-chats-${reason}-${userId}-${Date.now()}`,
  })
}

export const embeddingQueue = new Queue<EmbeddingJob>('episodic-memory', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
})

// Keep payload expiry independent of long-running backups and other maintenance.
export const payloadRetentionQueue = new Queue('payload-retention', {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 100, removeOnFail: 100 },
})

// Analytics bookkeeping is frequent and cheap; keep it off the maintenance queue's single lane.
export const analyticsQueue = new Queue<AnalyticsJob>('analytics', {
  connection,
  defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 100 },
})

/** Folds collaborative document update logs into their snapshot and refreshes derived Markdown. */
export const fileDocQueue = new Queue<FileDocJob>('file-docs', {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: true, removeOnFail: 1_000 },
})

/** Transcribes the takes of voice recordings. Rate-limited or failed provider calls are retried. */
export const fileRecordingQueue = new Queue<FileRecordingJob>('file-recordings', {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 15_000 }, removeOnComplete: true, removeOnFail: 1_000 },
})
