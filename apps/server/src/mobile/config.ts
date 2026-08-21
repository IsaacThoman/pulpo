import { parseDictationSettings } from '../settings/application-settings.js'

export function mobileDictationEnabled(value: unknown): boolean {
  const settings = parseDictationSettings(value)
  return settings.enabled && Boolean(settings.encryptedGroqApiKey)
}
