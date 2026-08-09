import { CHAT_PRESET_ICON_NAMES, isChatPresetIcon, type ChatPresetIcon } from '@pulpo/contracts'

export const PRESET_ICON_SEARCH_LIMIT = 60

export const POPULAR_PRESET_ICON_NAMES = [
  'brain',
  'zap',
  'zap-off',
  'gauge',
  'sparkles',
  'rocket',
  'circle',
  'flame',
  'timer',
  'bot',
  'code-xml',
  'image',
  'search',
  'globe',
  'shield',
  'wand-sparkles',
  'chart-no-axes-column',
  'message-circle',
] as const satisfies readonly ChatPresetIcon[]

export interface PresetIconOption {
  id: ChatPresetIcon
  label: string
}

export function resolvePresetIconName(name: unknown): ChatPresetIcon {
  return isChatPresetIcon(name) ? name : 'circle'
}

export function formatPresetIconLabel(name: string): string {
  return name.split('-').map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : '').join(' ')
}

export function filterPresetIconOptions(query: string): PresetIconOption[] {
  const normalized = query.trim().toLowerCase()
  const names = normalized
    ? CHAT_PRESET_ICON_NAMES.filter((name) => name.includes(normalized)).slice(0, PRESET_ICON_SEARCH_LIMIT)
    : POPULAR_PRESET_ICON_NAMES
  return names.map((id) => ({ id, label: formatPresetIconLabel(id) }))
}
