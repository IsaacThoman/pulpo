import { computerOsLabel, type AgentComputer, type WorkspaceSelection } from '@pulpo/contracts'

export const SANDBOX_WORKSPACE: WorkspaceSelection = { kind: 'sandbox' }
export const SANDBOX_WORKSPACE_LABEL = 'Cloud sandbox'

export type WorkspaceChoice = {
  id: string
  label: string
  /** Secondary text: OS and availability, or the reason the computer cannot be chosen. */
  detail: string
  selected: boolean
  /** `select` picks the workspace, `pair` requests access from this device, `null` is informational. */
  action: 'select' | 'pair' | null
  selection: WorkspaceSelection
}

/** Why a computer can or cannot be chosen right now, in the words the picker shows. */
export function computerHint(computer: AgentComputer): string {
  if (!computer.enabled) return 'Turned off'
  if (!computer.online) return 'Offline'
  if (computer.pairing?.status === 'pending') return 'Pairing requested…'
  if (computer.pairing?.status === 'denied') return 'Pairing denied'
  if (computer.selectable) return computer.accessMode === 'full' ? 'Full access' : 'Folder access'
  if (!computer.isOwnedByThisDevice && !computer.pairing && computer.allowRemote) return 'Pair this device'
  if (!computer.allowRemote) return 'Remote use is off'
  return 'Unavailable'
}

export function computerCanPair(computer: AgentComputer): boolean {
  return !computer.selectable && computer.enabled && computer.online && computer.allowRemote && !computer.isOwnedByThisDevice
    && (!computer.pairing || computer.pairing.status === 'revoked' || computer.pairing.status === 'denied')
}

/** Follow-up messages can select any available workspace. */
export function workspaceChoices(computers: readonly AgentComputer[], selection: WorkspaceSelection): WorkspaceChoice[] {
  const selectedComputerId = selection.kind === 'computer' ? selection.computerId : null
  const rows: WorkspaceChoice[] = computers.map((computer) => ({
    id: computer.id, label: computer.name, detail: `${computerOsLabel(computer.os)} · ${computerHint(computer)}`,
    selected: selectedComputerId === computer.id,
    action: computer.selectable ? 'select' : computerCanPair(computer) ? 'pair' : null,
    selection: { kind: 'computer', computerId: computer.id },
  }))
  if (selectedComputerId && !rows.some((row) => row.id === selectedComputerId)) rows.push({
    id: selectedComputerId, label: 'Your computer', detail: 'This computer is not available right now',
    selected: true, action: null, selection,
  })
  return [{
    id: 'sandbox', label: SANDBOX_WORKSPACE_LABEL, detail: 'Runs in an isolated cloud workspace',
    selected: selectedComputerId === null, action: 'select', selection: SANDBOX_WORKSPACE,
  }, ...rows]
}

/** Keep the selected destination even when its availability changes. */
export function effectiveWorkspaceSelection(selection: WorkspaceSelection | undefined, previousComputerId?: string | null): WorkspaceSelection {
  return selection ?? (previousComputerId ? { kind: 'computer', computerId: previousComputerId } : SANDBOX_WORKSPACE)
}

export function workspaceMenuLabel(choices: readonly WorkspaceChoice[]): string {
  return choices.find((choice) => choice.selected)?.label ?? SANDBOX_WORKSPACE_LABEL
}
