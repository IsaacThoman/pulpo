import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { providerApiFormatSchema, type ProviderApiFormat } from '@pulpo/contracts'
import type { providerConnections } from '../database/schema.js'
import { getConfig } from '../config.js'
import { decryptSecret } from '../lib/crypto.js'
import { anthropicSdkBaseUrl, openAnthropicMessagesStream } from './anthropic-messages.js'
import { openChatCompletionsStream } from './chat-completions.js'
import type { ResponsesResult, ResponsesStreamEvent } from './responses-builder.js'

type Provider = typeof providerConnections.$inferSelect
export type UpstreamProvider = Pick<Provider, 'id' | 'apiFormat' | 'baseUrl' | 'encryptedApiKey' | 'organizationId' | 'projectId' | 'requestTimeoutMs'>

type RequestOptions = { signal?: AbortSignal; headers?: Record<string, string> }
type CreateBody = Record<string, unknown> & { model: string }

/** A completed generation, shaped like the subset of an OpenAI `Response` Pulpo reads. */
export type UpstreamResponse = Pick<ResponsesResult, 'id' | 'status' | 'output' | 'output_text' | 'usage' | 'incomplete_details'>

/**
 * One text-generation client per provider, whatever wire protocol it speaks.
 * Callers always send Responses API bodies and receive Responses API events.
 */
export interface UpstreamTextClient {
  readonly format: ProviderApiFormat
  /** Present only for Responses providers, which also support files, retrieval, and cancellation. */
  readonly openai?: OpenAI
  readonly responses: {
    create(body: CreateBody & { stream: true }, options?: RequestOptions): Promise<AsyncIterable<ResponsesStreamEvent>>
    create(body: CreateBody & { stream?: false | undefined }, options?: RequestOptions): Promise<UpstreamResponse>
  }
}

export function providerApiFormat(provider: { apiFormat?: string | null }): ProviderApiFormat {
  const parsed = providerApiFormatSchema.safeParse(provider.apiFormat)
  return parsed.success ? parsed.data : 'openai_responses'
}

/** Drain a translated stream into the final response it describes. */
export async function collectResponse(events: AsyncIterable<{ type: string; [key: string]: unknown }>): Promise<UpstreamResponse> {
  let terminal: UpstreamResponse | undefined
  for await (const event of events) {
    if (event.type === 'response.completed' || event.type === 'response.incomplete') terminal = event.response as UpstreamResponse
  }
  if (!terminal) throw new Error('Provider stream ended without a response')
  return terminal
}

export function createUpstreamTextClient(provider: UpstreamProvider, options: { fetch?: typeof fetch; maxRetries?: number } = {}): UpstreamTextClient {
  const apiKey = decryptSecret(provider.encryptedApiKey, getConfig().ENCRYPTION_KEY)
  const format = providerApiFormat(provider)
  if (format === 'anthropic_messages') {
    const anthropic = new Anthropic({
      apiKey,
      baseURL: anthropicSdkBaseUrl(provider.baseUrl),
      timeout: provider.requestTimeoutMs,
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
    const stream = (body: CreateBody, requestOptions?: RequestOptions) => openAnthropicMessagesStream(anthropic, body, requestOptions ?? {})
    return {
      format,
      responses: {
        create: (async (body: CreateBody, requestOptions?: RequestOptions) => body.stream
          ? stream(body, requestOptions)
          : collectResponse(await stream(body, requestOptions))) as UpstreamTextClient['responses']['create'],
      },
    }
  }
  const openai = new OpenAI({
    apiKey,
    baseURL: provider.baseUrl,
    organization: provider.organizationId ?? undefined,
    project: provider.projectId ?? undefined,
    timeout: provider.requestTimeoutMs,
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  if (format === 'openai_chat_completions') {
    const stream = (body: CreateBody, requestOptions?: RequestOptions) => openChatCompletionsStream(openai, body, { baseUrl: provider.baseUrl, ...requestOptions })
    return {
      format,
      responses: {
        create: (async (body: CreateBody, requestOptions?: RequestOptions) => body.stream
          ? stream(body, requestOptions)
          : collectResponse(await stream(body, requestOptions))) as UpstreamTextClient['responses']['create'],
      },
    }
  }
  return {
    format,
    openai,
    responses: {
      create: ((body: CreateBody, requestOptions?: RequestOptions) => openai.responses.create(withoutPulpoReasoning(body) as never, requestOptions)) as unknown as UpstreamTextClient['responses']['create'],
    },
  }
}

/**
 * Reasoning items produced by translated providers carry only Pulpo metadata
 * and summaries, which the Responses API would reject as unknown or
 * unresolvable items. Drop them and strip Pulpo-only fields.
 */
export function withoutPulpoReasoning<T extends Record<string, unknown>>(body: T): T {
  if (!Array.isArray(body.input)) return body
  const input = body.input.filter((raw) => {
    const item = raw as Record<string, unknown> | null
    return !(item && item.type === 'reasoning' && typeof item.pulpo_format === 'string')
  })
  return input.length === body.input.length ? body : { ...body, input }
}
