import { describe, expect, it } from 'vitest'
import { resolveWorkspace, workspaceSelectionSchema, workspaceRecoverySchema, WORKSPACE_UNRESPONSIVE_MS } from './workspaces.js'
import { composerStateSchema, emptyComposerState } from './composer.js'

describe('workspace contracts', () => {
  const computer = { kind: 'computer' as const, deviceId: '00000000-0000-4000-8000-000000000001', rootId: '00000000-0000-4000-8000-000000000002' }
  it('migrates legacy booleans and gives explicit selection precedence', () => {
    expect(resolveWorkspace(undefined, true)).toEqual({ kind: 'pulpo' })
    expect(resolveWorkspace(undefined, false)).toEqual({ kind: 'none' })
    expect(resolveWorkspace(computer, false)).toEqual(computer)
    expect(resolveWorkspace({ kind: 'none' }, true)).toEqual({ kind: 'none' })
  })
  it('keeps computer selection through composer synchronization', () => {
    expect(composerStateSchema.parse({ ...emptyComposerState(), workspace: computer }).workspace).toEqual(computer)
    expect(workspaceSelectionSchema.safeParse({ kind: 'computer', deviceId: 'not-an-id' }).success).toBe(false)
  })
  it('requires a switch target and uses the agreed liveness deadline', () => {
    expect(workspaceRecoverySchema.safeParse({ generation: 0, action: 'switch' }).success).toBe(false)
    expect(workspaceRecoverySchema.parse({ generation: 1, action: 'switch', workspace: computer }).acknowledgeUnknown).toBe(false)
    expect(WORKSPACE_UNRESPONSIVE_MS).toBe(30_000)
  })
})
