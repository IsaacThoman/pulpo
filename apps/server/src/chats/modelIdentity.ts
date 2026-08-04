export function responseDisplayModelId(response: {
  modelId: string
  actualModelId?: string | null
}): string {
  return response.actualModelId ?? response.modelId
}
