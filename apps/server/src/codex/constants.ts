export const CODEX_PROVIDER_ID = '00000000-0000-7000-8000-000000000004'
export const CODEX_LAB_ID = '00000000-0000-7000-8000-000000000003'
export const CODEX_PI_PROVIDER_ID = 'openai-codex'
export const CODEX_MODEL_PREFIX = 'codex:'

export function codexCatalogModelId(upstreamModelId: string): string {
  return `${CODEX_MODEL_PREFIX}${upstreamModelId}`
}

export function isCodexModelId(modelId: string): boolean {
  return modelId.startsWith(CODEX_MODEL_PREFIX)
}

export function isManagedProviderId(providerId: string): boolean {
  return providerId === CODEX_PROVIDER_ID
}

export function isManagedLabId(labId: string): boolean {
  return labId === CODEX_LAB_ID
}
