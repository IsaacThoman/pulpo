import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ begin: vi.fn(), update: vi.fn(), write: vi.fn() }))
vi.mock('./provider-diagnostics.js', () => ({ beginDiagnostic: mocks.begin, updateDiagnostic: mocks.update, writeDiagnosticPayload: mocks.write,
  diagnosticContext: new AsyncLocalStorage(), diagnosticFailure: () => ({ failureStage: 'transport' }) }))
import { diagnosticFetch } from './diagnostic-fetch.js'
import { diagnosticPayload, MAX_DIAGNOSTIC_BYTES, parseDiagnosticBody } from './diagnostic-sanitizer.js'
beforeEach(() => { vi.clearAllMocks(); mocks.begin.mockResolvedValue({ id: 'attempt', capture: true }); mocks.update.mockResolvedValue(undefined); mocks.write.mockResolvedValue(undefined) })
const context = { purpose: 'image_edit', userId: 'user', providerId: 'provider', modelId: 'image' }

describe('provider diagnostics', () => {
  it('retains HTTP failure details before an adapter cancels the body, without credentials', async () => {
    const body = { error: { code: 'invalid_image', param: 'image', type: 'invalid_request_error', message: 'Invalid input Bearer SECRET_VALUE' } }
    const fetch = diagnosticFetch(context, vi.fn().mockResolvedValue(Response.json(body, { status: 400, headers: { 'x-request-id': 'req-123', 'retry-after': '3' } })))
    const response = await fetch('https://provider.test/v1/images/edits?api_key=SECRET_VALUE', { method: 'POST', headers: { Authorization: 'Bearer SECRET_VALUE' }, body: JSON.stringify({ prompt: 'hat', api_key: 'SECRET_VALUE' }) })
    await response.body?.cancel()
    expect(mocks.update).toHaveBeenCalledWith('attempt', expect.objectContaining({ httpStatus: 400, providerRequestId: 'req-123', retryAfter: '3' }))
    expect(mocks.update).toHaveBeenCalledWith('attempt', expect.objectContaining({ errorCode: 'invalid_image', errorParameter: 'image', failureStage: 'provider' }), 'failed')
    expect(JSON.stringify([mocks.update.mock.calls, mocks.write.mock.calls])).not.toContain('SECRET_VALUE')
  })
  it('captures metadata but no request or response bodies when logging is off', async () => {
    mocks.begin.mockResolvedValue({ id: 'off', capture: false })
    const fetch = diagnosticFetch(context, vi.fn().mockResolvedValue(Response.json({ error: { code: 'bad_input', message: 'Invalid image' } }, { status: 400 })))
    await fetch('https://provider.test', { body: JSON.stringify({ prompt: 'private' }), method: 'POST' })
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith('off', expect.objectContaining({ errorCode: 'bad_input' }), 'failed')
  })
  it('preserves successful stream bytes, records first-token time and redacts image data', async () => {
    const text = 'data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"b64_json":"AAAA","usage":{"output_tokens":1}}\n\n'
    const fetch = diagnosticFetch(context, vi.fn().mockResolvedValue(new Response(text, { headers: { 'content-type': 'text/event-stream' } })))
    const response = await fetch('https://provider.test')
    expect(await response.text()).toBe(text)
    expect(mocks.update).toHaveBeenCalledWith('attempt', expect.objectContaining({ firstTokenMs: expect.any(Number) }), 'completed')
    expect(mocks.write).toHaveBeenCalledWith('attempt', 'responsePayload', expect.objectContaining({ fidelity: 'reconstructed' }))
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain('AAAA')
  })
  it('records cancellation without draining an unbounded stream', async () => {
    const cancel = vi.fn()
    const source = new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode('data: {"delta":"x"}\n\n')) }, cancel })
    const fetch = diagnosticFetch(context, vi.fn().mockResolvedValue(new Response(source, { headers: { 'content-type': 'text/event-stream' } })))
    const response = await fetch('https://provider.test')
    const reader = response.body!.getReader(); await reader.read(); await reader.cancel()
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledWith('attempt', expect.objectContaining({ failureStage: 'cancelled' }), 'cancelled')
  })
  it('bounds capture and omits multipart binary data', async () => {
    const form = new FormData(); form.set('prompt', 'edit'); form.set('image[]', new Blob(['binary-private'], { type: 'image/jpeg' }), 'private-name.jpg')
    const fetch = diagnosticFetch(context, vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: 'x'.repeat(MAX_DIAGNOSTIC_BYTES * 3) }), { headers: { 'content-type': 'application/json' } })))
    await (await fetch('https://provider.test', { method: 'POST', body: form })).text()
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain('binary-private')
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain('private-name.jpg')
    expect(mocks.write).toHaveBeenCalledWith('attempt', 'responsePayload', expect.objectContaining({ fidelity: 'truncated' }))
    expect(JSON.stringify(mocks.write.mock.calls).length).toBeLessThan(MAX_DIAGNOSTIC_BYTES + 2000)
  })
  it('labels changes accurately and removes signed URLs and media', () => {
    expect(diagnosticPayload({ prompt: 'hello' }).fidelity).toBe('exact')
    const p = diagnosticPayload({ url: 'https://example.test/file?signature=private', image: 'data:image/png;base64,AAAA', password: 'secret' })
    expect(p.fidelity).toBe('redacted'); expect(JSON.stringify(p)).not.toContain('private'); expect(JSON.stringify(p)).not.toContain('AAAA')
    expect(parseDiagnosticBody('{"b64_json":"' + 'A'.repeat(MAX_DIAGNOSTIC_BYTES), 'application/json', true)).toEqual({ fidelity: 'truncated', body: '[body exceeded capture limit]' })
  })
  it('retains a provider stream failure even when payload capture is disabled', async () => {
    mocks.begin.mockResolvedValue({ id: 'off', capture: false })
    const body = 'data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"Stream failed"}}}\n\n'
    const fetch = diagnosticFetch(context, vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    expect(await (await fetch('https://provider.test')).text()).toBe(body)
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith('off', expect.objectContaining({ failureStage: 'provider_stream', errorCode: 'server_error' }), 'failed')
  })
  it('bounds serialized JSON and omits short binary content blocks', () => {
    const payload = diagnosticPayload({ text: '\u0001'.repeat(MAX_DIAGNOSTIC_BYTES / 2) })
    expect(payload.fidelity).toBe('truncated')
    expect(Buffer.byteLength(JSON.stringify(payload.body))).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
    expect(diagnosticPayload({ type: 'image', data: 'AAAA' }).body).toEqual({ type: 'image', data: '[media omitted]' })
    expect(diagnosticPayload({ type: 'image_generation_call', result: 'AAAA' }).body).toEqual({ type: 'image_generation_call', result: '[media omitted]' })
  })

})
