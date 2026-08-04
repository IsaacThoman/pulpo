export function resolveVisibleOrder(savedOrder: string[], availableIds: string[]): string[] {
  const available = new Set(availableIds)
  const result = savedOrder.filter((id, index) => available.has(id) && savedOrder.indexOf(id) === index)
  for (const id of availableIds) if (!result.includes(id)) result.push(id)
  return result
}

export function orderedModelsById<T extends { id: string }>(models: T[], orderedIds: string[]): T[] {
  const byId = new Map(models.map((model) => [model.id, model]))
  return orderedIds.map((id) => byId.get(id)).filter((model): model is T => Boolean(model))
}
