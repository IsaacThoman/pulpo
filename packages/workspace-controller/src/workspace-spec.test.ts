import { describe, expect, it } from 'vitest'
import type * as k8s from '@kubernetes/client-node'
import { podMatchesSpec, WORKSPACE_SPEC_HASH_ANNOTATION, workspaceSpecHash, type WorkspaceSpec } from './workspace-spec.js'

const spec: WorkspaceSpec = {
  imageDigest: `ghcr.io/example/workspace@sha256:${'a'.repeat(64)}`,
  cpu: '2',
  memory: '2048Mi',
  ephemeralStorage: '20Gi',
}

function pod(options: { hash?: string; memory?: string; image?: string } = {}): k8s.V1Pod {
  return {
    metadata: { annotations: options.hash ? { [WORKSPACE_SPEC_HASH_ANNOTATION]: options.hash } : {} },
    spec: {
      containers: [{
        name: 'workspace',
        image: options.image ?? spec.imageDigest,
        resources: { requests: { cpu: '2', memory: options.memory ?? '2048Mi', 'ephemeral-storage': '20Gi' } },
      }],
    },
  }
}

describe('workspace pod compatibility', () => {
  it('uses the creation fingerprint when Kubernetes canonicalizes quantities', () => {
    expect(podMatchesSpec(pod({ hash: workspaceSpecHash(spec), memory: '2Gi' }), spec)).toBe(true)
  })

  it('rejects a fingerprint from a different desired spec', () => {
    const other = { ...spec, memory: '4096Mi' }
    expect(podMatchesSpec(pod({ hash: workspaceSpecHash(other), memory: '4Gi' }), spec)).toBe(false)
  })

  it('still verifies the immutable image reference', () => {
    expect(podMatchesSpec(pod({ hash: workspaceSpecHash(spec), image: spec.imageDigest.replace(/a/g, 'b') }), spec)).toBe(false)
  })

  it('supports exact legacy specs but replaces canonicalized legacy quantities once', () => {
    expect(podMatchesSpec(pod(), spec)).toBe(true)
    expect(podMatchesSpec(pod({ memory: '2Gi' }), spec)).toBe(false)
  })
})
