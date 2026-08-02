import { createHash } from 'node:crypto'
import type * as k8s from '@kubernetes/client-node'

export type WorkspaceSpec = {
  imageDigest: string
  cpu: string
  memory: string
  ephemeralStorage: string
}

export const WORKSPACE_SPEC_HASH_ANNOTATION = 'pulpo.dev/spec-hash'

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
