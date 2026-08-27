import { describe, expect, it, vi } from 'vitest'
import { EPISODIC_MEMORY_PROFILES } from './profiles.js'
import { OllamaClient } from './ollama.js'

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...init })
}

describe('OllamaClient', () => {
  it('reports health and installed model digests', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ version: '0.32.15' }))
      .mockResolvedValueOnce(json({ models: [{ name: 'embeddinggemma:300m-qat-q4_0', digest: 'sha256:abc', size: 239 }] }))
    const status = await new OllamaClient('http://ollama:11434', fetchImpl).status()
    expect(status).toEqual({
      healthy: true,
      version: '0.32.15',
      error: null,
      installedModels: [{ name: 'embeddinggemma:300m-qat-q4_0', digest: 'sha256:abc', size: 239 }],
    })
  })

  it('validates embedding dimensions', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ embeddings: [Array(3).fill(0.1)] }))
    await expect(new OllamaClient('http://ollama:11434', fetchImpl).embed(
      EPISODIC_MEMORY_PROFILES.embeddinggemma,
      'hello',
    )).rejects.toThrow('expected 768')
  })

  it('returns a validated embedding batch', async () => {
    const expected = Array(768).fill(0.125)
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ embeddings: [expected] }))
    await expect(new OllamaClient('http://ollama:11434', fetchImpl).embed(
      EPISODIC_MEMORY_PROFILES.embeddinggemma,
      'hello',
    )).resolves.toEqual([expected])
  })
})
