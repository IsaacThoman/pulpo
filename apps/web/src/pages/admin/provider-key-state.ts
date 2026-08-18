export interface ProviderKeyState {
  apiKey: string
  apiKeyChanged: boolean
  hasSavedApiKey: boolean
}

export function providerApiKeyPatch(state: ProviderKeyState): { apiKey?: string } {
  return state.apiKeyChanged && state.apiKey.trim() ? { apiKey: state.apiKey } : {}
}

export function hideProviderApiKey<T extends ProviderKeyState>(state: T): T {
  if (!state.hasSavedApiKey || state.apiKeyChanged) return state
  return { ...state, apiKey: '' }
}
