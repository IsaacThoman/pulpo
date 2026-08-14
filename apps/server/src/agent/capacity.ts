import { WORKSPACE_CONTINUE_WITHOUT_AGENT_DELAY_MS } from '@pulpo/contracts'

function controllerErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code : undefined
  } catch {
    return undefined
  }
}

export function isWorkspaceCapacityResponse(status: number, body: string): boolean {
  return status === 503 && (
    controllerErrorCode(body) === 'workspace_capacity_exhausted'
    || body.includes('Maximum active workspace capacity reached')
    || body.includes('Maximum controller workspace capacity reached')
  )
}

export function isCapacityReservationInvalidResponse(status: number, body: string): boolean {
  return status === 409 && controllerErrorCode(body) === 'workspace_capacity_reservation_invalid'
}

export function isCapacityReservationUnsupportedResponse(status: number): boolean {
  return status === 404
}

export function workspaceContinueWithoutAgentAvailableAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + WORKSPACE_CONTINUE_WITHOUT_AGENT_DELAY_MS)
}

export function workspaceContinueWithoutAgentIsAvailable(createdAt: Date, now = Date.now()): boolean {
  return now >= workspaceContinueWithoutAgentAvailableAt(createdAt).getTime()
}

export function workspaceQueuePosition(queueIds: string[], leaseId: string): number {
  const index = queueIds.indexOf(leaseId)
  return index < 0 ? 0 : index + 1
}
