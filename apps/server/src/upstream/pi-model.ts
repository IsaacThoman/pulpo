import type { Api, Model } from '@earendil-works/pi-ai'
import type { models, providerConnections } from '../database/schema.js'
import { anthropicModelCapabilities } from './anthropic-models.js'
import { anthropicSdkBaseUrl } from './anthropic-messages.js'
import { providerApiFormat } from './client.js'
import { passthroughParameters } from './responses-input.js'

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
    return { ...common, api: 'openai-completions', provider: 'openai', baseUrl: provider.baseUrl } as Model<'openai-completions'>
  }
  return { ...common, api: 'openai-responses', provider: 'openai', baseUrl: provider.baseUrl } as Model<'openai-responses'>
}

/**
 * Pi merges `samplingParams` into Chat Completions bodies verbatim. Keep the
 * keys that mean the same thing there and drop Responses-only ones; Pi itself
 * sets the token limit and reasoning effort from its stream options.
 */
export function chatCompletionsSamplingParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  return {
    ...passthroughParameters(parameters),
    ...Object.fromEntries(['temperature', 'top_p', 'service_tier', 'prompt_cache_key', 'safety_identifier', 'cache_control', 'parallel_tool_calls']
      .flatMap((key) => parameters[key] === undefined ? [] : [[key, parameters[key]]])),
  }
}
