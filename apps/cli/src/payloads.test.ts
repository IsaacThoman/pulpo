import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from './index.js'

beforeEach(() => {
  vi.stubEnv('PULPO_URL', 'https://pulpo.example.test')
  vi.stubEnv('PULPO_TOKEN', 's'.repeat(48))
})
afterEach(() => { vi.unstubAllEnvs() })
function cli(result: unknown, capabilities = ['usage', 'detailedPayloads']) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const request = vi.fn(async (_path: string) => result)
  const program = createProgram({ stdin: new PassThrough() as never, stdout, stderr }, {
    createClient: () => ({ info: async () => ({ managementApiVersion: 1, capabilities }), request }) as never,
  })
  return { program, stdout, stderr, request }
}

describe('detailed payload commands', () => {
  it.each([{ flags: [] }, { flags: ['--json'] }])('prints complete nested bodies as JSON with flags $flags', async ({ flags }) => {
    const result = { available: true, requestPayload: [{ turn: 1, payload: { input: 'a'.repeat(10_000) } }], responsePayload: { output: ['response'] }, ocrAttempts: [{ responsePayload: { text: 'ocr' } }] }
    const { program, stdout, stderr, request } = cli(result)
    await program.parseAsync(['node', 'pulpo', 'usage', 'payloads', 'call/id', ...flags])
    expect(request).toHaveBeenCalledWith('/api/management/v1/usage/requests/call%2Fid/payloads')
    expect(JSON.parse(stdout.read().toString())).toEqual(result)
    expect(stderr.read()).toBeNull()
  })
  it('preserves unavailable reasons instead of presenting empty data as captured', async () => {
    const result = { available: false, unavailableReason: 'expired', requestPayload: null, responsePayload: null }
    const { program, stdout } = cli(result)
    await program.parseAsync(['node', 'pulpo', 'usage', 'payloads', 'log', '--json'])
    expect(JSON.parse(stdout.read().toString())).toEqual(result)
  })
  it('reports an unsupported server before requesting payloads', async () => {
    const { program, request } = cli({}, ['usage'])
    await expect(program.parseAsync(['node', 'pulpo', 'usage', 'payloads', 'log'])).rejects.toThrow('update the server')
    expect(request).not.toHaveBeenCalled()
  })
  it('passes filters and pagination while preserving the response envelope', async () => {
    const result = { data: [{ id: 'call', requestLogId: 'log' }], nextCursor: '2026-09-01T12:00:00.000Z' }
    const { program, stdout, request } = cli(result)
    await program.parseAsync(['node', 'pulpo', 'usage', 'requests', '--range', 'all', '--limit', '10', '--cursor', '2026-09-02T12:00:00+01:00', '--status', 'completed,failed', '--origin', 'web', '--model', 'provider/model', '--identity', 'user-id', '--json'])
    const url = new URL(request.mock.calls[0]![0], 'https://pulpo.example.test')
    expect(Object.fromEntries(url.searchParams)).toEqual({ range: 'all', limit: '10', cursor: '2026-09-02T12:00:00+01:00', status: 'completed,failed', origin: 'web', model: 'provider/model', identity: 'user-id' })
    expect(JSON.parse(stdout.read().toString())).toEqual(result)
  })
  it.each([['--limit', '0'], ['--limit', '101'], ['--limit', '1.5'], ['--cursor', 'invalid']])('rejects invalid pagination %j', async (flag, value) => {
    const { program, request } = cli({})
    await expect(program.parseAsync(['node', 'pulpo', 'usage', 'requests', flag, value])).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
