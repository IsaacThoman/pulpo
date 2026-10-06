import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ANTHROPIC_VERSION, ProviderModelsError, fetchProviderModelIds, providerModelsRequest } from './models-endpoint.js'

describe('providerModelsRequest', () => {
  it('uses bearer auth for OpenAI-style providers', () => {
    for (const apiFormat of ['openai_responses', 'openai_chat_completions'] as const) {
      expect(providerModelsRequest({ baseUrl: 'https://api.example.com/v1/', apiFormat }, 'sk', 'ignored')).toEqual({
        url: 'https://api.example.com/v1/models', headers: { authorization: 'Bearer sk' },
      })
    }
  })

  it('uses Anthropic headers and pagination parameters', () => {
    expect(providerModelsRequest({ baseUrl: 'https://api.anthropic.com/v1', apiFormat: 'anthropic_messages' }, 'sk-ant')).toEqual({
      url: 'https://api.anthropic.com/v1/models?limit=1000',
      headers: { 'x-api-key': 'sk-ant', 'anthropic-version': ANTHROPIC_VERSION },
    })
    expect(providerModelsRequest({ baseUrl: 'https://api.anthropic.com/v1', apiFormat: 'anthropic_messages' }, 'k', 'claude-b').url)
      .toBe('https://api.anthropic.com/v1/models?limit=1000&after_id=claude-b')
  })
})

describe('fetchProviderModelIds', () => {
  type Handler = (url: URL, headers: IncomingHttpHeaders) => { status: number; body: string }
  let server: Server
  let baseUrl: string
  let handler: Handler
  const seen: Array<{ url: URL; headers: IncomingHttpHeaders }> = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      seen.push({ url, headers: req.headers })
      const { status, body } = handler(url, req.headers)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(() => {
    seen.length = 0
  })

  const json = (value: unknown) => ({ status: 200, body: JSON.stringify(value) })

  it('follows Anthropic cursor pagination, deduplicating and sorting ids', async () => {
    handler = (url) => url.searchParams.get('after_id') === 'claude-b'
      ? json({ data: [{ id: 'claude-a' }, { id: 'claude-c' }], has_more: false, last_id: 'claude-c' })
      : json({ data: [{ id: 'claude-b' }, { id: ' claude-a ' }, { id: 7 }, {}], has_more: true, first_id: 'claude-b', last_id: 'claude-b' })
    const ids = await fetchProviderModelIds({ baseUrl, apiFormat: 'anthropic_messages', requestTimeoutMs: 5_000 }, 'sk-ant')
    expect(ids).toEqual(['claude-a', 'claude-b', 'claude-c'])
    expect(seen.map((request) => request.url.search)).toEqual(['?limit=1000', '?limit=1000&after_id=claude-b'])
    expect(seen[0]!.headers['x-api-key']).toBe('sk-ant')
    expect(seen[0]!.headers['anthropic-version']).toBe(ANTHROPIC_VERSION)
  })

  it('stops when the cursor does not advance', async () => {
    handler = () => json({ data: [{ id: 'same' }], has_more: true, last_id: 'same' })
    await expect(fetchProviderModelIds({ baseUrl, apiFormat: 'anthropic_messages', requestTimeoutMs: 5_000 }, 'k')).resolves.toEqual(['same'])
    expect(seen).toHaveLength(2)
  })

  it('reads a single page for OpenAI-style providers', async () => {
    handler = () => json({ object: 'list', data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }], has_more: true, last_id: 'b' })
    await expect(fetchProviderModelIds({ baseUrl, apiFormat: 'openai_chat_completions', requestTimeoutMs: 5_000 }, 'sk')).resolves.toEqual(['a', 'b'])
    expect(seen).toHaveLength(1)
    expect(seen[0]!.headers.authorization).toBe('Bearer sk')
  })

  it('reports non-200, invalid, and unreachable responses', async () => {
    const provider = { baseUrl, apiFormat: 'openai_responses' as const, requestTimeoutMs: 5_000 }
    handler = () => ({ status: 401, body: '{}' })
    await expect(fetchProviderModelIds(provider, 'k')).rejects.toMatchObject({ code: 'upstream_error', message: 'Provider /models returned 401' })
    handler = () => json({ models: [] })
    await expect(fetchProviderModelIds(provider, 'k')).rejects.toMatchObject({ code: 'upstream_invalid' })
    handler = () => ({ status: 200, body: 'not json' })
    const error = await fetchProviderModelIds(provider, 'k').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderModelsError)
    expect(error).toMatchObject({ code: 'upstream_invalid' })
    await expect(fetchProviderModelIds({ ...provider, baseUrl: 'http://127.0.0.1:1/v1' }, 'k')).rejects.toMatchObject({ code: 'upstream_unreachable' })
  })
})
