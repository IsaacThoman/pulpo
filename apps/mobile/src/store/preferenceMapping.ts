export type ThemePreference = 'system' | 'light' | 'dark'
export type TextSizePreference = 'default' | 'large' | 'extra-large'
export type TrashRetentionPreference = 'instant' | '24h' | '7d' | '30d' | '90d' | 'indefinite'

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
  favoriteModelIds: string[]
  defaultModelId: string | null
  agentMode: boolean
  /** Per-model map of generation preset id to selected choice id. */
  generation: Record<string, Record<string, string>>
}

export const defaultPreferences: Preferences = {
  theme: 'system', textSize: 'default', streamResponses: true, showReasoning: true,
  haptics: true, sendWithEnter: true, attachmentCacheMb: 256, localChatLimit: 50,
  trashRetention: '30d', favoriteModelIds: [], defaultModelId: null, agentMode: false,
  generation: {},
}

const trashRetentionValues: TrashRetentionPreference[] = ['instant', '24h', '7d', '30d', '90d', 'indefinite']

export function preferencesFromServer(values: Record<string, unknown>): Partial<Preferences> {
  const result: Partial<Preferences> = {}
  if (values.theme === 'system' || values.theme === 'light' || values.theme === 'dark') result.theme = values.theme
  if (typeof values.sendWithEnter === 'boolean') result.sendWithEnter = values.sendWithEnter
  if (typeof values.streamResponses === 'boolean') result.streamResponses = values.streamResponses
  if (typeof values.showReasoning === 'boolean') result.showReasoning = values.showReasoning
  if (typeof values.agentModeEnabled === 'boolean') result.agentMode = values.agentModeEnabled
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
  return result
}

export function preferencePatchForServer<K extends keyof Preferences>(key: K, value: Preferences[K]): Record<string, unknown> | null {
  const serverKey = key === 'attachmentCacheMb' ? 'localAttachmentCacheMb'
    : key === 'agentMode' ? 'agentModeEnabled'
      : ['theme', 'sendWithEnter', 'streamResponses', 'showReasoning', 'localChatLimit', 'trashRetention', 'defaultModelId'].includes(key)
        ? key
        : null
  return serverKey ? { [serverKey]: value } : null
}
