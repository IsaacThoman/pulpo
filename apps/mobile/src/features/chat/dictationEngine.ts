export type DictationEngine = 'server' | 'device'
export type DictationEnginePreference = DictationEngine

/**
 * Picks where a recording is transcribed. The server model is the default because
 * it is usually more accurate; on-device transcription is used when the user
 * prefers it, the server has no dictation configured, or the app is offline.
 */
export function resolveDictationEngine(input: {
  preference: DictationEnginePreference
  serverAvailable: boolean
  deviceAvailable: boolean
  offline: boolean
}): DictationEngine | null {
  if (!input.deviceAvailable) return input.serverAvailable ? 'server' : null
  if (input.preference === 'device' || !input.serverAvailable || input.offline) return 'device'
  return 'server'
}

export const DICTATION_ENGINE_OPTIONS = [
  { value: 'server', label: 'Server' },
  { value: 'device', label: 'On device' },
] as const satisfies readonly { value: DictationEnginePreference; label: string }[]

/** Explains the dictation engine setting for the current server. */
export function dictationEngineFooter(serverAvailable: boolean): string {
  return serverAvailable
    ? 'Server transcription is usually more accurate. On-device transcription is private and is also used automatically while you are offline.'
    : 'This server does not offer transcription, so dictation always runs on this iPhone.'
}
