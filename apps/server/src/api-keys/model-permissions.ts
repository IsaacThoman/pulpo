import { MAX_MODEL_CHAIN_LENGTH } from '../responses/fallback-policy.js'

export type PermissionModel = {
  id: string
  enabled: boolean
  visible: boolean
  fallbackModelId: string | null
}

export type PresetRedirect = {
  modelId: string
  targetModelId: string
}

export function authorizedModelIds(
  permittedModelIds: string[],
  catalog: PermissionModel[],
  redirects: PresetRedirect[],
  maximumChainLength = MAX_MODEL_CHAIN_LENGTH,
): Set<string> {
  const authorized = new Set(permittedModelIds)
  if (maximumChainLength <= 1) return authorized

  const byId = new Map(catalog.map((model) => [model.id, model]))
  const redirectTargets = new Map<string, Set<string>>()
  for (const redirect of redirects) {
    const targets = redirectTargets.get(redirect.modelId) ?? new Set<string>()
    targets.add(redirect.targetModelId)
    redirectTargets.set(redirect.modelId, targets)
  }

  for (const permittedModelId of permittedModelIds) {
    const root = byId.get(permittedModelId)
    if (!root?.enabled || !root.visible) continue
    const queue: Array<{ modelId: string; chainLength: number }> = [{ modelId: root.id, chainLength: 1 }]
    const shortestChain = new Map<string, number>([[root.id, 1]])
    for (let position = 0; position < queue.length; position += 1) {
      const current = queue[position]!
      if (current.chainLength >= maximumChainLength) continue
      const model = byId.get(current.modelId)
      const targets = new Set(redirectTargets.get(current.modelId) ?? [])
      if (model?.fallbackModelId) targets.add(model.fallbackModelId)
      for (const targetId of targets) {
        const target = byId.get(targetId)
        if (!target?.enabled) continue
        const chainLength = current.chainLength + 1
        if ((shortestChain.get(targetId) ?? Number.POSITIVE_INFINITY) <= chainLength) continue
        shortestChain.set(targetId, chainLength)
        authorized.add(targetId)
        queue.push({ modelId: targetId, chainLength })
      }
    }
  }
  return authorized
}

export function modelPermissionAllows(
  requestedModelId: string,
  permittedModelIds: string[],
  catalog: PermissionModel[],
  redirects: PresetRedirect[],
  maximumChainLength = MAX_MODEL_CHAIN_LENGTH,
): boolean {
  if (permittedModelIds.length === 0 || permittedModelIds.includes(requestedModelId)) return true
  return authorizedModelIds(permittedModelIds, catalog, redirects, maximumChainLength).has(requestedModelId)
}
