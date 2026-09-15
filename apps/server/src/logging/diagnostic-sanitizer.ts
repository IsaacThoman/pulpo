export const MAX_DIAGNOSTIC_BYTES = 128 * 1024
export type PayloadFidelity = 'exact' | 'redacted' | 'reconstructed' | 'truncated'
export interface DiagnosticPayload { fidelity: PayloadFidelity; body: unknown }
const sensitiveKey = /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|encrypted.*)$/i
const binaryKey = /^(b64_json|image_base64|audio_data|bytes|base64)$/i

export function safeDiagnosticText(value: unknown, secrets: string[] = [], max = 1024): string | undefined {
  if (typeof value !== 'string') return undefined
  let text = value
  for (const secret of secrets.filter(s => s.length >= 4)) text = text.split(secret).join('[redacted]')
  return text.replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-|sess-|mt-pulpo-)[A-Za-z0-9_.-]+/g, '[redacted]')
    .replace(/data:[^\s"']+/gi, '[media omitted]')
    .replace(/([?&](?:key|token|secret|signature|sig|credential|x-amz-[^=\s]+)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/[\p{Cc}\p{Cs}]/gu, ' ').slice(0, max)
}

/** Never keep credentials, binary media, or unbounded provider output in diagnostic copies. */
export function diagnosticPayload(value: unknown, fidelity: PayloadFidelity = 'exact', secrets: string[] = []): DiagnosticPayload {
  let changed = false, budget = MAX_DIAGNOSTIC_BYTES, truncated = false
  const visit = (v: unknown, depth = 0, key = ''): unknown => {
    if (budget <= 0 || depth > 32) { truncated = true; return '[truncated]' }
    if (sensitiveKey.test(key)) { changed = true; return '[redacted]' }
    if (binaryKey.test(key) || v instanceof Uint8Array || v instanceof Blob) { changed = true; return '[media omitted]' }
    if (typeof v === 'string') {
      if (/^data:|^[A-Za-z0-9+/]{2048,}={0,2}$/.test(v)) { changed = true; return '[media omitted]' }
      let s = v
      for (const secret of secrets.filter(s => s.length >= 4)) s = s.split(secret).join('[redacted]')
      s = s.replace(/\b(?:sk-|sess-|mt-pulpo-)[A-Za-z0-9_.-]+/g, '[redacted]').replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [redacted]')
      if (/^https?:\/\//i.test(s)) { try { const u = new URL(s); if (u.search || u.username || u.password) { u.search = ''; u.username = ''; u.password = ''; s = u.toString() } } catch {} }
      if (s !== v) changed = true
      const bytes = Buffer.byteLength(s)
      if (bytes > budget) { s = Buffer.from(s).subarray(0, Math.max(0, budget)).toString('utf8'); truncated = true }
      budget -= bytes
      return s
    }
    if (Array.isArray(v)) { const out: unknown[] = []; for (const x of v) { if (budget <= 0) { truncated = true; break }; budget -= 8; out.push(visit(x, depth + 1)) }; return out }
    if (v && typeof v === 'object') { const out: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) { if (budget <= 0) { truncated = true; break }; budget -= Buffer.byteLength(k) + 8; out[k] = visit(x, depth + 1, ((k === 'data' && /image|audio/.test(String((v as Record<string, unknown>).type ?? ''))) || (k === 'result' && (v as Record<string, unknown>).type === 'image_generation_call')) ? 'base64' : k) }; return out }
    return v
  }
  let body = visit(value)
  // Escaping control characters can expand JSON beyond the traversal budget.
  if (Buffer.byteLength(JSON.stringify(body) ?? 'null') > MAX_DIAGNOSTIC_BYTES) { body = '[body exceeded capture limit]'; truncated = true }
  return { body, fidelity: truncated || fidelity === 'truncated' ? 'truncated' : fidelity === 'reconstructed' ? 'reconstructed' : changed ? 'redacted' : fidelity }
}

export function parseDiagnosticBody(text: string, contentType: string, truncated = false, secrets: string[] = []): DiagnosticPayload {
  let value: unknown
  if (contentType.includes('text/event-stream')) {
    value = text.split(/\r?\n\r?\n/).flatMap(frame => {
      const data = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      if (!data || data === '[DONE]') return []
      try { return [JSON.parse(data)] } catch { return [] }
    })
    return diagnosticPayload(value, truncated ? 'truncated' : 'reconstructed', secrets)
  }
  try { value = JSON.parse(text) } catch { value = truncated ? '[body exceeded capture limit]' : safeDiagnosticText(text, secrets, 1024); return diagnosticPayload(value, truncated ? 'truncated' : 'reconstructed', secrets) }
  return diagnosticPayload(value, truncated ? 'truncated' : 'exact', secrets)
}
