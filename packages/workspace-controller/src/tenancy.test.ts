import { describe, expect, it } from 'vitest'
import { effectiveWarmTargets, instanceIdHash, normalizeInstanceId } from './tenancy.js'
import { workspaceSpecHash, type WorkspaceSpec } from './workspace-spec.js'

const spec: WorkspaceSpec = {
  imageDigest: `ghcr.io/example/workspace@sha256:${'a'.repeat(64)}`,
  cpu: '2',
  memory: '2048Mi',
  ephemeralStorage: '20Gi',
}

describe('workspace controller tenancy', () => {
  it('accepts stable deployment and FQDN instance ids', () => {
    expect(normalizeInstanceId('production')).toBe('production')
    expect(normalizeInstanceId('preview/pulpo/pr-42.example.com')).toBe('preview/pulpo/pr-42.example.com')
  })

  it('rejects missing, ambiguous, and unsafe instance ids', () => {
    expect(() => normalizeInstanceId(undefined)).toThrow()
    expect(() => normalizeInstanceId(['one', 'two'])).toThrow()
    expect(() => normalizeInstanceId('../preview owner')).toThrow()
  })

  it('creates a stable Kubernetes-safe owner fingerprint', () => {
    expect(instanceIdHash('preview/pulpo/pr-42.example.com')).toMatch(/^[a-f0-9]{32}$/)
    expect(instanceIdHash('preview/pulpo/pr-42.example.com')).toBe(instanceIdHash('preview/pulpo/pr-42.example.com'))
  })

  it('shares warm capacity by spec without allowing the last caller to lower it', () => {
    const other = { ...spec, memory: '4096Mi' }
    const targets = effectiveWarmTargets([
      { spec, capacity: 1 },
      { spec, capacity: 0 },
      { spec, capacity: 3 },
      { spec: other, capacity: 2 },
    ])

    expect(targets.get(workspaceSpecHash(spec))?.capacity).toBe(3)
    expect(targets.get(workspaceSpecHash(other))?.capacity).toBe(2)
    expect(targets).toHaveLength(2)
  })
})
