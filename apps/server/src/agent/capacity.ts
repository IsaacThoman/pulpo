export function isWorkspaceCapacityResponse(status: number, body: string): boolean {
  return status === 503 && body.includes('Maximum active workspace capacity reached')
}

export function workspaceQueuePosition(queueIds: string[], leaseId: string): number {
  const index = queueIds.indexOf(leaseId)
  return index < 0 ? 0 : index + 1
}
