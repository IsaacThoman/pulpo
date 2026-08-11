export type ThemePreference = 'system' | 'light' | 'dark'
export type TextSizePreference = 'default' | 'large' | 'extra-large'
export type TrashRetentionPreference = 'instant' | '24h' | '7d' | '30d' | '90d' | 'indefinite'
export type AutomaticChatExpirationPreference = 'disabled' | '24h' | '7d'

export interface Preferences {
  theme: ThemePreference
  textSize: TextSizePreference
  streamResponses: boolean
  showReasoning: boolean
  haptics: boolean
  sendWithEnter: boolean
  attachmentCacheMb: number
  localChatLimit: number
  trashRetention: TrashRetentionPreference
  automaticChatExpiration: AutomaticChatExpirationPreference
  newChatAutoExpire: boolean
  favoriteModelIds: string[]
  providerOrder: string[]
  defaultModelId: string | null
  agentMode: boolean
  /** Per-model map of generation preset id to selected choice id. */
  generation: Record<string, Record<string, string>>
}

export const defaultPreferences: Preferences = {
  theme: 'system', textSize: 'default', streamResponses: true, showReasoning: true,
  haptics: true, sendWithEnter: true, attachmentCacheMb: 256, localChatLimit: 50,
  trashRetention: '30d', automaticChatExpiration: 'disabled', newChatAutoExpire: true, favoriteModelIds: [], providerOrder: [], defaultModelId: null, agentMode: false,
  generation: {},
}

const trashRetentionValues: TrashRetentionPreference[] = ['instant', '24h', '7d', '30d', '90d', 'indefinite']
const automaticChatExpirationValues: AutomaticChatExpirationPreference[] = ['disabled', '24h', '7d']

export function preferencesFromServer(values: Record<string, unknown>): Partial<Preferences> {
  const result: Partial<Preferences> = {
    favoriteModelIds: validOrderedIds(values.favoriteModelIds),
    providerOrder: validOrderedIds(values.providerOrder),
    generation: validGenerationPreferences(values.generation),
  }
  if (values.theme === 'system' || values.theme === 'light' || values.theme === 'dark') result.theme = values.theme
  if (typeof values.sendWithEnter === 'boolean') result.sendWithEnter = values.sendWithEnter
  if (typeof values.streamResponses === 'boolean') result.streamResponses = values.streamResponses
  if (typeof values.showReasoning === 'boolean') result.showReasoning = values.showReasoning
  if (typeof values.defaultModelId === 'string') result.defaultModelId = values.defaultModelId || null
  if (typeof values.localChatLimit === 'number' && Number.isFinite(values.localChatLimit)) {
    result.localChatLimit = Math.max(0, Math.min(50, Math.floor(values.localChatLimit)))
  }
  if (typeof values.localAttachmentCacheMb === 'number' && Number.isFinite(values.localAttachmentCacheMb)) {
    result.attachmentCacheMb = Math.max(0, Math.floor(values.localAttachmentCacheMb))
  }
  if (typeof values.trashRetention === 'string' && trashRetentionValues.includes(values.trashRetention as TrashRetentionPreference)) {
    result.trashRetention = values.trashRetention as TrashRetentionPreference
  }
  if (typeof values.automaticChatExpiration === 'string' && automaticChatExpirationValues.includes(values.automaticChatExpiration as AutomaticChatExpirationPreference)) {
    result.automaticChatExpiration = values.automaticChatExpiration as AutomaticChatExpirationPreference
  }
  if (typeof values.newChatAutoExpire === 'boolean') result.newChatAutoExpire = values.newChatAutoExpire
  return result
}

function validOrderedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
}

function validGenerationPreferences(value: unknown): Preferences['generation'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([modelId, selections]) => {
    if (!selections || typeof selections !== 'object' || Array.isArray(selections)) return []
    const validSelections = Object.fromEntries(
      Object.entries(selections).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    return [[modelId, validSelections]]
  }))
}

export function preferencePatchForServer<K extends keyof Preferences>(key: K, value: Preferences[K]): Record<string, unknown> | null {
  const serverKey = key === 'attachmentCacheMb' ? 'localAttachmentCacheMb'
    : ['theme', 'sendWithEnter', 'streamResponses', 'showReasoning', 'localChatLimit', 'trashRetention', 'automaticChatExpiration', 'newChatAutoExpire', 'defaultModelId', 'favoriteModelIds', 'providerOrder', 'generation'].includes(key)
      ? key
      : null
  return serverKey ? { [serverKey]: value } : null
}
