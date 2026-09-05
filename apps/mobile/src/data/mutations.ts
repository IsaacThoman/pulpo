import { notifyOutboxChanged } from './outboxNotifications'
import * as Crypto from 'expo-crypto'
import { completeOutboxEntity, enqueueOutbox } from './database'

type OfflineMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'
let lastCreatedAt = 0

export async function queueOfflineMutation(input: {
  namespace: string
  entityKey: string
  method: OfflineMethod
  path: string
  body?: unknown
  idempotencyKey?: string
}): Promise<void> {
  const now = Date.now()
  lastCreatedAt = Math.max(now, lastCreatedAt + 1)
  if (input.entityKey.startsWith('setting:')) {
    // Settings patches carry the whole latest value, so only the newest queued value is useful.
    await completeOutboxEntity(input.namespace, input.entityKey)
  }
  await enqueueOutbox({
    id: input.idempotencyKey ?? Crypto.randomUUID(),
    namespace: input.namespace,
    entityKey: input.entityKey,
    method: input.method,
    path: input.path,
    body: input.body === undefined ? null : JSON.stringify(input.body),
    createdAt: lastCreatedAt,
    attempts: 0,
    nextAttemptAt: 0,
  })
  notifyOutboxChanged(input.namespace)
}
