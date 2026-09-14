import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentComputer, ComputerPairing, WorkspaceSelection } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'

export interface AgentComputerListResponse { computers: AgentComputer[]; enabled: boolean }

export const agentComputersQueryKey = (userId: string | undefined) => ['agent-computers', userId ?? 'anonymous'] as const
export const agentPairingsQueryKey = (userId: string | undefined) => ['agent-pairings', userId ?? 'anonymous'] as const

export function fetchAgentComputers(): Promise<AgentComputerListResponse> {
  return apiRequest<AgentComputerListResponse>('/api/agent/computers')
}

/** Computers the account has registered, refreshed whenever the server bumps the `computers` scope. */
export function useAgentComputers(options: { enabled?: boolean } = {}) {
  const userId = useAuth((state) => state.user?.id)
  const agentAvailable = useCatalog((state) => state.agentAvailable)
  return useQuery({
    queryKey: agentComputersQueryKey(userId),
    queryFn: fetchAgentComputers,
    enabled: Boolean(userId) && agentAvailable && (options.enabled ?? true),
    staleTime: 15_000,
  })
}

export function useAgentPairings(options: { enabled?: boolean } = {}) {
  const userId = useAuth((state) => state.user?.id)
  return useQuery({
    queryKey: agentPairingsQueryKey(userId),
    queryFn: () => apiRequest<{ pairings: ComputerPairing[] }>('/api/agent/pairings'),
    enabled: Boolean(userId) && (options.enabled ?? true),
    staleTime: 15_000,
  })
}

export function useInvalidateComputers() {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: agentComputersQueryKey(userId) }),
      queryClient.invalidateQueries({ queryKey: agentPairingsQueryKey(userId) }),
    ])
  }
}

export function requestComputerPairing(computerId: string, code: string): Promise<{ pairing: ComputerPairing }> {
  return apiRequest(`/api/agent/computers/${computerId}/pairings`, { method: 'POST', body: { code } })
}

export function revokeComputerPairing(computerId: string, pairingId: string): Promise<void> {
  return apiRequest(`/api/agent/computers/${computerId}/pairings/${pairingId}`, { method: 'DELETE' })
}

export function removeComputer(computerId: string): Promise<void> {
  return apiRequest(`/api/agent/computers/${computerId}`, { method: 'DELETE' })
}

export function decideToolApproval(approvalId: string, approved: boolean): Promise<{ approval: { id: string; status: string } }> {
  return apiRequest(`/api/agent/approvals/${approvalId}/${approved ? 'approve' : 'deny'}`, { method: 'POST' })
}

/** Preserve an explicit choice; otherwise continue on the last selected workspace. */
export function effectiveWorkspaceSelection(selection: WorkspaceSelection | null, previousComputerId?: string | null): WorkspaceSelection {
  return selection ?? (previousComputerId ? { kind: 'computer', computerId: previousComputerId } : { kind: 'sandbox' })
}

/** Trigger label for the composer's agent menu. */
export function workspaceMenuLabel(selection: WorkspaceSelection, computers: readonly AgentComputer[]): string {
  if (selection.kind === 'computer') {
    const computer = computers.find((entry) => entry.id === selection.computerId)
    return `Pulpo Agent · ${computer?.name ?? 'Your computer'}`
  }
  return 'Pulpo Agent'
}
