import { beginDiagnostic, diagnosticContext, diagnosticFailure, updateDiagnostic, writeDiagnosticPayload, observeDiagnostic, type DiagnosticContext } from './provider-diagnostics.js'
import { diagnosticPayload, MAX_DIAGNOSTIC_BYTES, parseDiagnosticBody, safeDiagnosticText } from './diagnostic-sanitizer.js'

/** A bounded observer on the consumed stream: no tee, buffering of media, or additional upstream requests. */
export function diagnosticFetch(defaults?: DiagnosticContext, baseFetch: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const context = { ...defaults, ...diagnosticContext.getStore() }
    if (!context.purpose) return baseFetch(input, init)
    if (context.observation) context.observation.seen = true
    const row = observeDiagnostic(() => beginDiagnostic(context as DiagnosticContext))
    if (!row) return baseFetch(input, init)
    const started = Date.now()
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v))
    const secrets = ['authorization', 'api-key', 'x-api-key'].flatMap(k => { const v = headers.get(k); return v ? [v, v.replace(/^Bearer /i, '')] : [] })
    const url = observeDiagnostic(() => new URL(input instanceof Request ? input.url : String(input)))
    if (!url) return baseFetch(input, init)
    const metadata: Record<string, unknown> = { method: init?.method ?? (input instanceof Request ? input.method : 'GET'), endpoint: safeDiagnosticText(url.origin + url.pathname, secrets), sdkRetryCount: safeDiagnosticText(headers.get('x-stainless-retry-count'), [], 16) }
    observeDiagnostic(() => { if (row.capture) {
      const body = init?.body
      if (body instanceof FormData) {
        const fields: Record<string, unknown> = {}
        for (const [k, v] of body) {
          const value = typeof v === 'string' ? v : { mimeType: v.type, sizeBytes: v.size, media: '[omitted]' }
          if (k in fields) fields[k] = [...(Array.isArray(fields[k]) ? fields[k] as unknown[] : [fields[k]]), value]
          else fields[k] = value
        }
        writeDiagnosticPayload(row, 'requestPayload', diagnosticPayload(fields, 'reconstructed', secrets))
      } else if (typeof body === 'string') {
        writeDiagnosticPayload(row, 'requestPayload', parseDiagnosticBody(body.slice(0, MAX_DIAGNOSTIC_BYTES), headers.get('content-type') ?? '', Buffer.byteLength(body) > MAX_DIAGNOSTIC_BYTES, secrets))
      }
    }
    updateDiagnostic(row, metadata) })
    let response: Response
    try { response = await baseFetch(input, init) }
    catch (error) { observeDiagnostic(() => updateDiagnostic(row, { ...diagnosticFailure(error), errorMessage: safeDiagnosticText((error as Error)?.message, secrets), durationMs: Date.now() - started }, 'failed')); throw error }
    const type = response.headers.get('content-type') ?? ''
    Object.assign(metadata, { httpStatus: response.status, providerRequestId: safeDiagnosticText(response.headers.get('x-request-id') ?? response.headers.get('request-id'), secrets),
      retryAfter: safeDiagnosticText(response.headers.get('retry-after'), secrets), headersMs: Date.now() - started })
    observeDiagnostic(() => updateDiagnostic(row, metadata))
    const textBody = /json|text\//i.test(type)
    const reader = response.body?.getReader()
    if (!reader) { observeDiagnostic(() => updateDiagnostic(row, { durationMs: Date.now() - started }, response.ok ? 'completed' : 'failed')); return response }
    const chunks: Uint8Array[] = []; let bytes = 0, total = 0, firstTokenMs: number | undefined, finished = false, tokenTail = '', streamError: Record<string, unknown> | undefined
    const decoder = new TextDecoder()
    const observe = (chunk: Uint8Array) => {
      total += chunk.length
      if (textBody && (row.capture || !response.ok) && bytes < MAX_DIAGNOSTIC_BYTES) {
        const part = chunk.subarray(0, MAX_DIAGNOSTIC_BYTES - bytes); chunks.push(part.slice()); bytes += part.length
      }
      if (type.includes('text/event-stream')) {
        tokenTail = (tokenTail + decoder.decode(chunk, { stream: true })).slice(-MAX_DIAGNOSTIC_BYTES)
        // Count actual text/reasoning/tool argument deltas, not HTTP headers or role-only events.
        if (firstTokenMs === undefined && /"(?:delta|content|text|thinking|arguments)"\s*:\s*"[^"\s]/.test(tokenTail)) firstTokenMs = Date.now() - started
        let boundary: number
        tokenTail = tokenTail.replaceAll('\r\n', '\n')
        while ((boundary = tokenTail.indexOf('\n\n')) !== -1) {
          const frame = tokenTail.slice(0, boundary); tokenTail = tokenTail.slice(boundary + 2)
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
          try { const event = JSON.parse(data); if (event.type === 'error' || event.type === 'response.failed' || event.error) {
            const error = event.error ?? event.response?.error ?? event
            streamError = { failureStage: 'provider_stream', errorCode: safeDiagnosticText(error.code, secrets), errorMessage: safeDiagnosticText(error.message, secrets) ?? 'Provider stream failed' }
          } } catch { /* Partial and terminal SSE frames are not JSON errors. */ }
        }
      }
    }
    const finish = (status: string, extra: Record<string, unknown> = {}) => observeDiagnostic(() => {
      if (finished) return; finished = true
      if (streamError) { status = 'failed'; Object.assign(extra, streamError) }
      const text = Buffer.concat(chunks).toString('utf8')
      if (!response.ok) {
        let error: Record<string, unknown> = {}
        try { const parsed = JSON.parse(text); error = parsed.error ?? parsed } catch {}
        Object.assign(extra, { failureStage: 'provider', errorCode: safeDiagnosticText(error.code, secrets), errorType: safeDiagnosticText(error.type, secrets),
          errorParameter: safeDiagnosticText(error.param, secrets), errorMessage: safeDiagnosticText(error.message, secrets) ?? `Provider returned HTTP ${response.status}` })
      }
      if (row.capture && textBody) writeDiagnosticPayload(row, 'responsePayload', parseDiagnosticBody(text, type, total > bytes || status === 'cancelled', secrets))
      updateDiagnostic(row, { durationMs: Date.now() - started, responseBytes: total, ...(firstTokenMs !== undefined ? { firstTokenMs } : {}), ...extra }, status)
    })
    // Read error bodies before returning: adapters often cancel them without consuming anything.
    if (!response.ok) {
      try {
        while (bytes < MAX_DIAGNOSTIC_BYTES) { const p = await reader.read(); if (p.done) break; observeDiagnostic(() => observe(p.value)); if (!textBody) break }
      } catch (error) { Object.assign(metadata, { failureStage: 'error_body', bodyReadError: safeDiagnosticText((error as Error).message, secrets) }) } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
      finish('failed', metadata)
      return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers })
    }
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try { const p = await reader.read(); if (p.done) { finish('completed'); reader.releaseLock(); controller.close() } else { observeDiagnostic(() => observe(p.value)); controller.enqueue(p.value) } }
        catch (error) { finish('failed', { failureStage: 'stream', errorMessage: safeDiagnosticText((error as Error).message, secrets) }); controller.error(error) }
      },
      async cancel(reason) { await reader.cancel(reason).catch(() => undefined); reader.releaseLock(); finish('cancelled', { failureStage: 'cancelled' }) },
    })
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}
