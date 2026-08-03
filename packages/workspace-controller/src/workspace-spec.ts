import { createHash } from 'node:crypto'
import type * as k8s from '@kubernetes/client-node'

export type WorkspaceSpec = {
  imageDigest: string
  cpu: string
  memory: string
  ephemeralStorage: string
}

export const WORKSPACE_SPEC_HASH_ANNOTATION = 'pulpo.dev/spec-hash'
export const ORPHAN_STARTING_MAX_AGE_MS = 10 * 60 * 1000

export function workspaceSpecHash(spec: WorkspaceSpec): string {
  return createHash('sha256')
    .update(JSON.stringify([spec.imageDigest, spec.cpu, spec.memory, spec.ephemeralStorage]))
    .digest('hex')
}

export function podMatchesSpec(pod: k8s.V1Pod, spec: WorkspaceSpec): boolean {
  const container = pod.spec?.containers[0]
  if (container?.image !== spec.imageDigest) return false

  const recordedHash = pod.metadata?.annotations?.[WORKSPACE_SPEC_HASH_ANNOTATION]
  if (recordedHash) return recordedHash === workspaceSpecHash(spec)

  // Legacy pods have no fingerprint. Exact comparison intentionally replaces a
  // legacy pod once if Kubernetes canonicalized a quantity such as 2048Mi to 2Gi.
  const requests = container.resources?.requests
  return requests?.cpu === spec.cpu
    && requests?.memory === spec.memory
    && requests?.['ephemeral-storage'] === spec.ephemeralStorage
}

export function isUnleasedOrphanPod(pod: k8s.V1Pod): boolean {
  const labels = pod.metadata?.labels ?? {}
  if (labels['app.kubernetes.io/name'] !== 'pulpo-workspace' || labels['pulpo.dev/lease-id']) return false
  const state = labels['pulpo.dev/state']
  return state === 'starting' || state === 'unknown' || state === undefined
}

export function isStaleStartingPod(pod: k8s.V1Pod, now = Date.now(), maxAgeMs = ORPHAN_STARTING_MAX_AGE_MS): boolean {
  if (!isUnleasedOrphanPod(pod) || pod.metadata?.labels?.['pulpo.dev/state'] !== 'starting') return false
  const createdAt = pod.metadata?.creationTimestamp ? new Date(pod.metadata.creationTimestamp).getTime() : Number.NaN
  return Number.isFinite(createdAt) && now - createdAt >= maxAgeMs
}
