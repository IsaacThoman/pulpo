import type { EpisodicMemoryModelProfile } from '@pulpo/contracts'
import { getConfig } from '../config.js'

export interface OllamaModel {
  name: string
  digest: string
  size: number
}

export interface OllamaStatus {
  healthy: boolean
  version: string | null
  error: string | null
  installedModels: OllamaModel[]
}

type Fetch = typeof globalThis.fetch

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

async function responseError(response: Response): Promise<Error> {
  const detail = (await response.text()).trim()
  return new Error(`Ollama returned ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`)
}

export class OllamaClient {
  constructor(
    private readonly baseUrl = getConfig().PULPO_OLLAMA_URL,
    private readonly fetchImpl: Fetch = globalThis.fetch,
    private readonly defaultSignal?: AbortSignal,
  ) {}

  private url(path: string): string {
    return new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString()
  }

  private signal(signal: AbortSignal | undefined, timeoutMs?: number): AbortSignal | undefined {
    const signals = [signal, this.defaultSignal, timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined]
      .filter((value): value is AbortSignal => Boolean(value))
    return signals.length > 1 ? AbortSignal.any(signals) : signals[0]
  }

  async status(signal?: AbortSignal): Promise<OllamaStatus> {
    try {
      const requestSignal = this.signal(signal, 5_000)
      const [versionResponse, tagsResponse] = await Promise.all([
        this.fetchImpl(this.url('api/version'), { signal: requestSignal }),
        this.fetchImpl(this.url('api/tags'), { signal: requestSignal }),
      ])
      if (!versionResponse.ok) throw await responseError(versionResponse)
      if (!tagsResponse.ok) throw await responseError(tagsResponse)
      const version = await versionResponse.json() as { version?: unknown }
      const tags = await tagsResponse.json() as { models?: Array<{ name?: unknown; model?: unknown; digest?: unknown; size?: unknown }> }
      return {
        healthy: true,
        version: typeof version.version === 'string' ? version.version : null,
        error: null,
        installedModels: (tags.models ?? []).flatMap((model) => {
          const name = typeof model.name === 'string' ? model.name : typeof model.model === 'string' ? model.model : null
          if (!name || typeof model.digest !== 'string') return []
          return [{ name, digest: model.digest, size: typeof model.size === 'number' ? model.size : 0 }]
        }),
      }
    } catch (error) {
      return { healthy: false, version: null, error: errorMessage(error), installedModels: [] }
    }
  }

  async pullModel(profile: EpisodicMemoryModelProfile, options: {
    signal?: AbortSignal
    onProgress?: (completed: number, total: number) => void
  } = {}): Promise<OllamaModel> {
    const response = await this.fetchImpl(this.url('api/pull'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: profile.model, stream: true }),
      signal: this.signal(options.signal),
    })
    if (!response.ok) throw await responseError(response)
    if (!response.body) throw new Error('Ollama model pull returned no response body')

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      buffer += value ?? ''
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as { error?: string; completed?: number; total?: number }
        if (event.error) throw new Error(event.error)
        if (typeof event.completed === 'number' && typeof event.total === 'number') {
          options.onProgress?.(event.completed, event.total)
        }
      }
      if (done) break
    }

    const status = await this.status(options.signal)
    if (!status.healthy) throw new Error(status.error ?? 'Ollama became unavailable after pulling the model')
    const installed = status.installedModels.find((model) => model.name === profile.model)
    if (!installed) throw new Error(`Ollama did not report ${profile.model} after a successful pull`)
    return installed
  }

  async embed(profile: EpisodicMemoryModelProfile, input: string | string[], signal?: AbortSignal): Promise<number[][]> {
    const response = await this.fetchImpl(this.url('api/embed'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: profile.model, input }),
      signal: this.signal(signal, 120_000),
    })
    if (!response.ok) throw await responseError(response)
    const body = await response.json() as { embeddings?: unknown }
    if (!Array.isArray(body.embeddings) || body.embeddings.some((embedding) => !Array.isArray(embedding))) {
      throw new Error('Ollama returned an invalid embedding response')
    }
    const embeddings = body.embeddings as number[][]
    for (const embedding of embeddings) {
      if (embedding.length !== profile.dimension || embedding.some((value) => !Number.isFinite(value))) {
        throw new Error(`Ollama returned ${embedding.length} dimensions for ${profile.model}; expected ${profile.dimension}`)
      }
    }
    return embeddings
  }
}
