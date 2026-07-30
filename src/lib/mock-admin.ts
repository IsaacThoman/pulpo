import { mulberry32 } from './mock'

export interface AdminConnection {
  id: string
  type: 'openai' | 'ollama'
  url: string
  auth: 'none' | 'bearer' | 'session' | 'oauth' | 'entra'
  key: string
  prefixId: string
  modelIds: string[]
  enabled: boolean
}

export const ADMIN_CONNECTIONS: AdminConnection[] = [
  { id: 'conn-1', type: 'openai', url: 'https://api.openai.com/v1', auth: 'bearer', key: 'sk-••••••••', prefixId: '', modelIds: [], enabled: true },
  { id: 'conn-2', type: 'openai', url: 'https://openrouter.ai/api/v1', auth: 'bearer', key: 'sk-or-••••••••', prefixId: 'or', modelIds: ['anthropic/claude-sonnet-4', 'deepseek/deepseek-r1'], enabled: true },
  { id: 'conn-3', type: 'openai', url: 'https://api.groq.com/openai/v1', auth: 'bearer', key: '', prefixId: 'groq', modelIds: [], enabled: false },
  { id: 'conn-4', type: 'ollama', url: 'http://host.docker.internal:11434', auth: 'none', key: '', prefixId: '', modelIds: [], enabled: true },
]

export interface AdminFunction {
  id: string
  type: 'pipe' | 'filter' | 'action' | 'event'
  name: string
  version: string
  author: string
  description: string
  enabled: boolean
  global: boolean
}

export const ADMIN_FUNCTIONS: AdminFunction[] = [
  { id: 'fn-1', type: 'filter', name: 'OpenWebUI Monitor (Invisible)', version: '0.3.1', author: 'isaac', description: 'Reports per-chat token usage to the monitor inlet/outlet endpoints.', enabled: true, global: true },
  { id: 'fn-2', type: 'action', name: 'Get Usage Button', version: '0.2.0', author: 'isaac', description: 'Adds a usage lookup action to every assistant message.', enabled: true, global: false },
  { id: 'fn-3', type: 'pipe', name: 'Anthropic Manifold', version: '1.4.2', author: 'community', description: 'Pipe Anthropic models through a unified manifold with prompt caching.', enabled: true, global: false },
  { id: 'fn-4', type: 'filter', name: 'Detoxify Filter', version: '0.1.0', author: 'community', description: 'Blocks toxic inlet messages using a local classifier.', enabled: false, global: false },
  { id: 'fn-5', type: 'event', name: 'Slack Notifier', version: '0.4.0', author: 'community', description: 'Posts signup and share events to a Slack webhook.', enabled: false, global: false },
  { id: 'fn-6', type: 'action', name: 'Export to Obsidian', version: '1.0.3', author: 'community', description: 'One-click export of a message into an Obsidian vault note.', enabled: true, global: false },
]

export interface ArenaModel {
  id: string
  name: string
  description: string
  modelIds: string[] // empty = all
  enabled: boolean
}

export const ARENA_MODELS: ArenaModel[] = [
  { id: 'arena-1', name: 'Flagship showdown', description: 'All top-tier proprietary models, blind.', modelIds: ['kimi-k3', 'gpt-4o', 'claude-sonnet-4'], enabled: true },
  { id: 'arena-2', name: 'Open-weight battle', description: 'Llama vs Qwen vs DeepSeek.', modelIds: ['llama-3.3-70b', 'qwen3-235b', 'deepseek-r1'], enabled: true },
]

export interface EvalRow {
  modelId: string
  rating: number
  won: number
  lost: number
  draws: number
}

export function makeEvalLeaderboard(): EvalRow[] {
  const rand = mulberry32(4242)
  const ids = ['kimi-k3', 'claude-sonnet-4', 'gpt-4o', 'deepseek-r1', 'qwen3-235b', 'gpt-4o-mini', 'llama-3.3-70b']
  return ids
    .map((modelId, i) => {
      const won = 40 + Math.floor(rand() * 220)
      const lost = 40 + Math.floor(rand() * 220)
      return {
        modelId,
        rating: Math.round(1150 + (6 - i) * 45 + rand() * 30),
        won,
        lost,
        draws: Math.floor(rand() * 30),
      }
    })
    .sort((a, b) => b.rating - a.rating)
}

export interface FeedbackRow {
  id: string
  userId: string
  modelId: string
  rating: 'up' | 'down'
  reason: string
  timestamp: number
  snippet: string
}

export function makeFeedback(): FeedbackRow[] {
  const rand = mulberry32(777)
  const users = ['u-isaac', 'u-maya', 'u-jonas', 'u-priya', 'u-tom', 'u-sam']
  const models = ['kimi-k3', 'gpt-4o', 'claude-sonnet-4', 'deepseek-r1', 'llama-3.3-70b', 'qwen3-235b']
  const downReasons = ['factually wrong', 'ignored instructions', 'too verbose', 'code did not run', 'refused a benign request', 'hallucinated citations']
  const snippets = [
    'The trick is to treat the stream as a single writer…',
    'You can fix this by adding an index on created_at…',
    'Here is a haiku about gradient descent…',
    'The naive approach re-renders the whole list per token…',
    'SSE is strictly simpler unless you need bidirectional…',
    'Set the temperature to 0 for deterministic output…',
  ]
  return Array.from({ length: 18 }, (_, i) => {
    const rating = rand() > 0.38 ? 'up' : 'down'
    return {
      id: `fb-${i}`,
      userId: users[Math.floor(rand() * users.length)],
      modelId: models[Math.floor(rand() * models.length)],
      rating,
      reason: rating === 'down' ? downReasons[Math.floor(rand() * downReasons.length)] : '',
      timestamp: Date.now() - Math.floor(rand() * rand() * 60) * 86_400_000,
      snippet: snippets[Math.floor(rand() * snippets.length)],
    } satisfies FeedbackRow
  }).sort((a, b) => b.timestamp - a.timestamp)
}

export interface Banner {
  id: string
  type: 'info' | 'warning' | 'error' | 'success'
  content: string
  dismissible: boolean
}

export const SEED_BANNERS: Banner[] = [
  { id: 'bn-1', type: 'info', content: 'pulpo will be down for maintenance Sunday 03:00–03:30 UTC.', dismissible: true },
]

export interface ToolServer {
  id: string
  kind: 'tool' | 'terminal' | 'knowledge'
  name: string
  url: string
  enabled: boolean
}

export const TOOL_SERVERS: ToolServer[] = [
  { id: 'ts-1', kind: 'tool', name: 'MCP filesystem', url: 'http://localhost:8930/mcp', enabled: true },
  { id: 'ts-2', kind: 'tool', name: 'web-fetch tools', url: 'https://tools.internal.dev/openapi.json', enabled: false },
  { id: 'ts-3', kind: 'terminal', name: 'dev box', url: 'http://10.0.0.42:7700', enabled: true },
  { id: 'ts-4', kind: 'knowledge', name: 'prod qdrant', url: 'https://qdrant.internal.dev:6333', enabled: true },
]
