import { describe, expect, it } from 'vitest'
import { BOUNDED_RUNTIME, storageSettings, workspacePodSlots } from './storage.js'
import { podMatchesSpec, workspaceSpecHash, WORKSPACE_SPEC_HASH_ANNOTATION } from './workspace-spec.js'

const spec = { imageDigest: 'example@sha256:abc', cpu: '2', memory: '2048Mi', ephemeralStorage: '20Gi' }
describe('bounded workspace storage', () => {
  it('rejects a requested allowance the runtime cannot enforce', () => {
    expect(() => storageSettings(BOUNDED_RUNTIME, { ...spec, ephemeralStorage: '50Gi' })).toThrow('fixed 20Gi')
    expect(storageSettings(BOUNDED_RUNTIME, spec).limit).toBe('21Gi')
  })
  it('does not reuse a matching image/spec from the previous runtime', () => {
    const pod = { metadata: { annotations: { [WORKSPACE_SPEC_HASH_ANNOTATION]: workspaceSpecHash(spec) } }, spec: { runtimeClassName: 'kata', containers: [{ name: 'workspace', image: spec.imageDigest }] } }
    expect(podMatchesSpec(pod, spec, BOUNDED_RUNTIME)).toBe(false)
    pod.spec.runtimeClassName = BOUNDED_RUNTIME
    expect(podMatchesSpec(pod, spec, BOUNDED_RUNTIME)).toBe(true)
  })
  it('counts starting, warm and terminating pods across controller restarts', () => {
    expect(workspacePodSlots([
      { status: { phase: 'Pending' } }, { status: { phase: 'Running' } },
      { status: { phase: 'Failed' }, metadata: { deletionTimestamp: new Date() } },
      { status: { phase: 'Failed' } }, { status: { phase: 'Succeeded' } }, {},
    ])).toBe(4)
  })
})
