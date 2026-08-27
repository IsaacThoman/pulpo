import { embeddingQueue } from '../jobs.js'

function reportSchedulingFailure(scope: 'chat' | 'user', id: string, reason: string, error: unknown): void {
  console.warn(JSON.stringify({
    level: 'warn',
    service: 'pulpo-server',
    event: 'episodic_memory.schedule_failed',
    scope,
    id,
    reason,
    error: error instanceof Error ? error.message : String(error),
  }))
}

export async function scheduleChatIndex(chatId: string, userId: string, reason: string): Promise<void> {
  try {
    await embeddingQueue.add('index-chat', { type: 'index-chat', chatId, userId }, {
      jobId: `index-chat-${chatId}-${Date.now()}`,
    })
  } catch (error) {
    // Indexing is derived work and must never make the originating chat mutation fail.
    reportSchedulingFailure('chat', chatId, reason, error)
  }
}

export async function scheduleUserIndex(userId: string, reason: string): Promise<void> {
  try {
    await embeddingQueue.add('index-user', { type: 'index-user', userId }, {
      jobId: `index-user-${userId}-${Date.now()}`,
    })
  } catch (error) {
    reportSchedulingFailure('user', userId, reason, error)
  }
}
