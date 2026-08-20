export type FirstTokenTimeout = {
  signal: AbortSignal | undefined
  clear: () => void
}

export function createFirstTokenTimeout(
  enabled: boolean,
  timeoutSeconds: number,
  parentSignal?: AbortSignal,
): FirstTokenTimeout {
  if (!enabled) return { signal: parentSignal, clear: () => undefined }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('First-token timeout')), timeoutSeconds * 1_000)
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal
  return { signal, clear: () => clearTimeout(timer) }
}
