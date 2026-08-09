import { createHash } from 'node:crypto'
import { workspaceSpecHash, type WorkspaceSpec } from './workspace-spec.js'

export const WORKSPACE_INSTANCE_HEADER = 'x-pulpo-instance-id'
export const WORKSPACE_INSTANCE_ANNOTATION = 'pulpo.dev/instance-id'
export const WORKSPACE_INSTANCE_HASH_LABEL = 'pulpo.dev/instance-hash'

const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/

export function normalizeInstanceId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) throw new Error('Exactly one Pulpo instance id is required')
  const normalized = value?.trim()
  if (!normalized || !INSTANCE_ID_PATTERN.test(normalized)) {
    throw new Error('A valid Pulpo instance id is required')
  }
  return normalized
}

export function instanceIdHash(instanceId: string): string {
  return createHash('sha256').update(instanceId).digest('hex').slice(0, 32)
}

export type WarmRequest = {
  spec: WorkspaceSpec
  capacity: number
}

export type WarmTarget = WarmRequest & {
  specHash: string
}

/** Shared warm pools use the largest request for each immutable workspace spec. */
export function effectiveWarmTargets(requests: Iterable<WarmRequest>): Map<string, WarmTarget> {
  const targets = new Map<string, WarmTarget>()
  for (const request of requests) {
    const capacity = Math.max(0, Math.min(100, Math.trunc(request.capacity)))
    if (!capacity) continue
    const specHash = workspaceSpecHash(request.spec)
    const existing = targets.get(specHash)
    if (!existing || capacity > existing.capacity) targets.set(specHash, { ...request, capacity, specHash })
  }
  return targets
}
