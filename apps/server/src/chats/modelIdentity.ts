import { UNKNOWN_MODEL_ID } from '@pulpo/contracts'

export function importedModelIdentity(
  sourceModelId: string,
  enabledModelIds: ReadonlySet<string>,
  sourceMetadata: Record<string, string> = {},
): { modelId: string; metadata: Record<string, string> } {
  const modelId = enabledModelIds.has(sourceModelId) ? sourceModelId : UNKNOWN_MODEL_ID
  const importedModelId = sourceMetadata.importedModelId ?? sourceModelId
  const metadata = modelId === UNKNOWN_MODEL_ID && importedModelId && importedModelId !== UNKNOWN_MODEL_ID
    ? { ...sourceMetadata, importedModelId }
    : sourceMetadata
  return { modelId, metadata }
}

export function responseDisplayModelId(response: {
  modelId: string
  actualModelId?: string | null
  metadata?: Record<string, string> | null
}): string {
  return response.metadata?.importedModelId ?? response.actualModelId ?? response.modelId
}
