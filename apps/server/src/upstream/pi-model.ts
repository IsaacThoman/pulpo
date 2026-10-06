import type { Api, Model } from '@earendil-works/pi-ai'
import type { models, providerConnections } from '../database/schema.js'
import { anthropicModelCapabilities } from './anthropic-models.js'
import { anthropicSdkBaseUrl } from './anthropic-messages.js'
import { providerApiFormat } from './client.js'
import { passthroughParameters } from './responses-input.js'
import { acceptsCacheControl, prefersMaxCompletionTokens } from './chat-completions.js'

type CatalogModel = Pick<typeof models.$inferSelect, 'upstreamModelId' | 'name' | 'contextWindow' | 'maxOutputTokens'>
type Provider = Pick<typeof providerConnections.$inferSelect, 'apiFormat' | 'baseUrl'>

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** The Pi model Agent mode streams through, matching the provider's wire protocol. */
export function piModelForProvider(model: CatalogModel, provider: Provider): Model<Api> {
  const common = {
    id: model.upstreamModelId,
    name: model.name,
    reasoning: true,
    input: ['text', 'image'] as Array<'text' | 'image'>,
    cost: ZERO_COST,
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutputTokens,
  }
  const format = providerApiFormat(provider)
  if (format === 'mistral_chat_completions') {
    // Pi appends v1/chat/completions itself; the catalog URL includes /v1.
    return { ...common, api: 'mistral-conversations', provider: 'mistral', baseUrl: provider.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') } as Model<'mistral-conversations'>
  }
  if (format === 'anthropic_messages') {
    const capabilities = anthropicModelCapabilities(model.upstreamModelId)
    return {
      ...common,
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: anthropicSdkBaseUrl(provider.baseUrl),
      compat: {
        forceAdaptiveThinking: capabilities.adaptiveThinking,
        supportsTemperature: capabilities.sampling,
      },
      thinkingLevelMap: {
        xhigh: capabilities.efforts.has('xhigh') ? 'xhigh' : 'high',
        max: capabilities.efforts.has('max') ? 'max' : 'high',
      },
    } as Model<'anthropic-messages'>
  }
  if (format === 'openai_chat_completions') {
    // Pi assumes OpenAI's own request fields for hosts it does not recognize;
    // self-hosted servers (vLLM, Ollama, llama.cpp) reject `developer`, `store`,
    // and `max_completion_tokens`, so use the portable forms there.
    const compat = prefersMaxCompletionTokens(provider.baseUrl)
      ? undefined
      : { supportsDeveloperRole: false, supportsStore: false, maxTokensField: 'max_tokens' as const }
    return { ...common, api: 'openai-completions', provider: 'openai', baseUrl: provider.baseUrl, ...(compat ? { compat } : {}) } as Model<'openai-completions'>
  }
  return { ...common, api: 'openai-responses', provider: 'openai', baseUrl: provider.baseUrl } as Model<'openai-responses'>
}

/**
 * Pi merges `samplingParams` into Chat Completions bodies verbatim. Keep the
 * keys that mean the same thing there and drop Responses-only ones; Pi itself
 * sets the token limit and reasoning effort from its stream options.
 */
export function chatCompletionsSamplingParameters(parameters: Record<string, unknown>, baseUrl: string): Record<string, unknown> {
  const openai = prefersMaxCompletionTokens(baseUrl)
  const keys = ['temperature', 'top_p', 'parallel_tool_calls', ...(openai ? ['service_tier', 'prompt_cache_key', 'safety_identifier'] : []), ...(acceptsCacheControl(baseUrl) ? ['cache_control'] : [])]
  return {
    ...passthroughParameters(parameters),
    ...Object.fromEntries(keys.flatMap((key) => parameters[key] === undefined ? [] : [[key, parameters[key]]])),
  }
}

/** Chat Completions reasoning effort only when the model was configured with one; not every model accepts it. */
export function explicitReasoningEffort(parameters: Record<string, unknown>): boolean {
  const reasoning = parameters.reasoning
  return Boolean(reasoning && typeof reasoning === 'object' && typeof (reasoning as Record<string, unknown>).effort === 'string')
}

/** Pi's native Mistral adapter uses camelCase options, then serializes the wire body. */
export function mistralAgentPayload(payload: unknown, parameters: Record<string, unknown>): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Mistral request payload')
  const sampling = chatCompletionsSamplingParameters(parameters, 'https://api.mistral.ai/v1')
  const reasoning = parameters.reasoning
  const effort = reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning)
    ? (reasoning as Record<string, unknown>).effort
    : parameters.reasoning_effort
  if (effort !== undefined && effort !== 'none' && effort !== 'high') throw new Error('Mistral reasoning effort must be none or high')
  delete sampling.reasoning_effort
  return { ...payload, ...sampling, ...(effort !== undefined ? { reasoningEffort: effort } : {}) }
}
