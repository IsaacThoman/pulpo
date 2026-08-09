export const MAX_MODEL_CHAIN_LENGTH = 8

export type GenerationErrorCategory =
  | 'provider_http'
  | 'rate_limit'
  | 'timeout'
  | 'worker'
  | 'budget'
  | 'validation'
  | 'cancellation'

export type FallbackPolicyModel = {
  id: string
  stickyFallbackSeconds: number
  slowStickyEnabled: boolean
  slowStickyMinTokensPerSecond: number
  slowStickyMinCompletionSeconds: number
}

type StickyStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<unknown>
}

const RETRYABLE_ERROR_CATEGORIES = new Set<GenerationErrorCategory>([
  'provider_http',
  'rate_limit',
  'timeout',
  'worker',
])

export class GenerationAttemptError extends Error {
  constructor(message: string, readonly outputStarted: boolean) {
    super(message)
    this.name = 'GenerationAttemptError'
  }
}

export function modelStickyKey(modelId: string): string {
  return `pulpo:model-sticky:${modelId}`
}

export async function isModelSticky(store: StickyStore, modelId: string): Promise<boolean> {
  return Boolean(await store.get(modelStickyKey(modelId)))
}

export async function markModelSticky(
  store: StickyStore,
  model: Pick<FallbackPolicyModel, 'id' | 'stickyFallbackSeconds'>,
  reason: string,
): Promise<boolean> {
  if (model.stickyFallbackSeconds <= 0) return false
  await store.set(modelStickyKey(model.id), reason, 'EX', model.stickyFallbackSeconds)
  return true
}

export function completionTokensPerSecond(durationMs: number, outputTokens: number): number {
  return (Math.max(0, outputTokens) * 1_000) / Math.max(durationMs, 1)
}

export function isSlowCompletion(
  model: Pick<FallbackPolicyModel, 'slowStickyEnabled' | 'stickyFallbackSeconds' | 'slowStickyMinCompletionSeconds' | 'slowStickyMinTokensPerSecond'>,
  durationMs: number,
  outputTokens: number,
): boolean {
  return model.slowStickyEnabled
    && model.stickyFallbackSeconds > 0
    && durationMs >= model.slowStickyMinCompletionSeconds * 1_000
    && completionTokensPerSecond(durationMs, outputTokens) < model.slowStickyMinTokensPerSecond
}

export function classifyGenerationError(error: unknown): GenerationErrorCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('compaction')) return 'worker'
  if (message.includes('rate') || message.includes('429')) return 'rate_limit'
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) return 'timeout'
  if (message.includes('budget') || message.includes('balance')) return 'budget'
  if (message.includes('validation') || message.includes('invalid')) return 'validation'
  if (/\b5\d\d\b/.test(message) || message.includes('fetch') || message.includes('network') || message.includes('connect')) return 'provider_http'
  if (message.includes('cancel')) return 'cancellation'
  return 'worker'
}

export function canFallbackAfterGenerationError(error: unknown, outputStarted?: boolean): boolean {
  const protectedOutput = outputStarted ?? (error instanceof GenerationAttemptError && error.outputStarted)
  return !protectedOutput && RETRYABLE_ERROR_CATEGORIES.has(classifyGenerationError(error))
}
