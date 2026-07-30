export type AiIconKind = 'lab' | 'model'

export interface AiIconDefinition {
  id: string
  label: string
  kind: AiIconKind
  contexts?: readonly AiIconKind[]
  color: boolean
  file: string
}

/** One catalog for every company and model mark available to the UI. */
export const AI_ICONS = [
  { id: 'anthropic', label: 'Anthropic', kind: 'lab', color: false, file: 'anthropic.svg' },
  { id: 'claude', label: 'Claude', kind: 'model', color: false, file: 'claude.svg' },
  { id: 'claude-color', label: 'Claude color', kind: 'model', color: true, file: 'claude-color.svg' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'lab', color: false, file: 'deepseek.svg' },
  { id: 'deepseek-color', label: 'DeepSeek color', kind: 'model', color: true, file: 'deepseek-color.svg' },
  { id: 'gemini', label: 'Gemini', kind: 'model', color: false, file: 'gemini.svg' },
  { id: 'gemini-color', label: 'Gemini color', kind: 'model', color: true, file: 'gemini-color.svg' },
  { id: 'google', label: 'Google', kind: 'lab', color: false, file: 'google.svg' },
  { id: 'google-color', label: 'Google color', kind: 'lab', color: true, file: 'google-color.svg' },
  { id: 'grok', label: 'Grok', kind: 'model', color: false, file: 'grok.svg' },
  { id: 'meta', label: 'Meta', kind: 'lab', color: false, file: 'meta.svg' },
  { id: 'meta-color', label: 'Meta color', kind: 'model', color: true, file: 'meta-color.svg' },
  { id: 'mistral', label: 'Mistral', kind: 'lab', color: false, file: 'mistral.svg' },
  { id: 'mistral-color', label: 'Mistral color', kind: 'model', color: true, file: 'mistral-color.svg' },
  {
    id: 'moonshot',
    label: 'Moonshot AI',
    kind: 'lab',
    contexts: ['lab', 'model'],
    color: false,
    file: 'moonshot.svg',
  },
  { id: 'openai', label: 'OpenAI', kind: 'lab', color: false, file: 'openai.svg' },
  { id: 'qwen', label: 'Qwen', kind: 'model', color: false, file: 'qwen.svg' },
  { id: 'qwen-color', label: 'Qwen color', kind: 'model', color: true, file: 'qwen-color.svg' },
  { id: 'xai', label: 'xAI', kind: 'lab', color: false, file: 'xai.svg' },
] as const satisfies readonly AiIconDefinition[]

export type AiIconId = (typeof AI_ICONS)[number]['id']

export const DEFAULT_PROVIDER_ICONS: Record<string, AiIconId> = {
  'moonshot ai': 'moonshot',
  openai: 'openai',
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  meta: 'meta',
  alibaba: 'qwen',
  mistral: 'mistral',
  xai: 'xai',
  google: 'google',
}

export function getAiIcon(id: string) {
  return AI_ICONS.find((icon) => icon.id === id) ?? AI_ICONS[0]
}

export function isAiIconAvailable(icon: (typeof AI_ICONS)[number], context: AiIconKind) {
  return icon.kind === context || ('contexts' in icon && icon.contexts.includes(context))
}

export function providerIcon(provider: string): AiIconId {
  return DEFAULT_PROVIDER_ICONS[provider.toLowerCase()] ?? 'openai'
}

export function aiIconPath(id: string) {
  return `/ai-icons/${getAiIcon(id).file}`
}
