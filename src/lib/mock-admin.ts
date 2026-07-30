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
