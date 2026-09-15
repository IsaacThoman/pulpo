/** Read only bounded structured error data; raw provider text never crosses the tool boundary. */
async function errorDetails(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader()
  if (!reader) return {}
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(2000)])
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  deadline.addEventListener('abort', cancel, { once: true })
  try {
    if (deadline.aborted) return {}
    const chunks: Uint8Array[] = []
    let size = 0
    while (!deadline.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 16 * 1024) return {}
      chunks.push(value)
    }
    if (deadline.aborted) return {}
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!payload || typeof payload !== 'object' || !('error' in payload)) return {}
    return payload.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : {}
  } catch { return {} }
  finally {
    deadline.removeEventListener('abort', cancel)
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function imageProviderError(response: Response, signal: AbortSignal): Promise<string> {
  const error = await errorDetails(response, signal)
  if (signal.aborted) return 'Image generation was cancelled or timed out'
  if (response.status === 401 || response.status === 403) return 'Image provider credentials or access are invalid; contact an admin'
  if (response.status === 429) return 'Image provider rate limit reached; try again later'
  if (response.status === 404) return 'Image provider model or endpoint was not found; contact an admin'
  if (response.status === 400 || response.status === 422) {
    const code = typeof error.code === 'string' ? error.code.toLowerCase() : ''
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
    if (['content_policy_violation', 'moderation_blocked', 'safety_violations'].includes(code)) {
      return 'Image provider explicitly rejected this request under its content policy; do not retry the same request'
    }
    if (['invalid_image_format', 'unsupported_image', 'unsupported_image_format'].includes(code)
      || /(?:unsupported|invalid|unrecognized) (?:image |file )?(?:format|mime type)|(?:format|mime type).{0,80}(?:unsupported|not supported)|\bmpo\b/.test(message)) {
      return 'Image provider rejected the reference image format; re-export it as a standard PNG or JPEG before trying again'
    }
    if (['image_too_large', 'image_size_exceeded'].includes(code)) return 'Image provider rejected the image size; use a smaller reference image'
    return `Image provider rejected the request (HTTP ${response.status}); the reason is unconfirmed. Do not assume a content-policy restriction or retry unchanged inputs`
  }
  return `Image provider generation failed (HTTP ${response.status})`
}
