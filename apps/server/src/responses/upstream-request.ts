import type { ExecutionMode } from '@pulpo/contracts'

/** Only send the optional background flag when asynchronous execution is requested. */
export function backgroundRequestParameter(executionMode: ExecutionMode): { background: true } | Record<string, never> {
  return executionMode === 'background' ? { background: true } : {}
}
