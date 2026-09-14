import { describe, expect, it } from 'vitest'
import type { AgentComputer } from '@pulpo/contracts'
import { computerHint, effectiveWorkspaceSelection, workspaceChoices, workspaceMenuLabel } from './workspacePicker'

const base: AgentComputer = {
  id: '00000000-0000-4000-8000-000000000001', name: 'Studio Mac', os: 'macos', arch: 'arm64', appVersion: '1.0.0',
  accessMode: 'folder', rootPath: '/Users/me/Pulpo', approvalPolicy: 'default', allowRemote: true, enabled: true, online: true,
  isOwnedByThisDevice: false, pairing: { id: '00000000-0000-4000-8000-000000000009', status: 'approved' }, selectable: true,
  lastSeenAt: null, createdAt: '2026-09-01T00:00:00.000Z',
}
const unpaired: AgentComputer = { ...base, id: '00000000-0000-4000-8000-000000000002', name: 'Work PC', os: 'windows', pairing: null, selectable: false }

describe('workspaceChoices', () => {
  it('offers the sandbox first and marks selectable computers', () => {
    const choices = workspaceChoices([base, unpaired], { kind: 'sandbox' })
    expect(choices.map((choice) => [choice.label, choice.action, choice.selected])).toEqual([
      ['Cloud sandbox', 'select', true],
      ['Studio Mac', 'select', false],
      ['Work PC', 'pair', false],
    ])
    expect(choices[1]!.detail).toBe('macOS · Folder access')
    expect(choices[2]!.detail).toBe('Windows · Pair this device')
  })

  it('allows follow-ups to switch to another computer or the sandbox', () => {
    const selection = { kind: 'computer' as const, computerId: base.id }
    const choices = workspaceChoices([base, { ...base, id: 'other', name: 'Other' }], selection)
    expect(choices.map((choice) => [choice.action, choice.selected])).toEqual([['select', false], ['select', true], ['select', false]])
    expect(workspaceMenuLabel(choices)).toBe('Studio Mac')
    expect(workspaceChoices([], selection)[1]).toMatchObject({ selected: true, action: null })
  })

  it('describes why a computer is unavailable', () => {
    expect(computerHint({ ...base, enabled: false })).toBe('Turned off')
    expect(computerHint({ ...base, online: false })).toBe('Offline')
    expect(computerHint({ ...unpaired, pairing: { id: 'p', status: 'pending' } })).toBe('Pairing requested…')
    expect(computerHint({ ...unpaired, allowRemote: false })).toBe('Remote use is off')
    expect(computerHint({ ...base, accessMode: 'full' })).toBe('Full access')
  })

  it('inherits the last choice without silently rerouting unavailable computers', () => {
    const selection = { kind: 'computer' as const, computerId: base.id }
    expect(effectiveWorkspaceSelection(selection, null)).toEqual(selection)
    expect(effectiveWorkspaceSelection(undefined, base.id)).toEqual(selection)
    expect(effectiveWorkspaceSelection({ kind: 'sandbox' }, base.id)).toEqual({ kind: 'sandbox' })
    expect(effectiveWorkspaceSelection(undefined, null)).toEqual({ kind: 'sandbox' })
  })
})
