export function agentSnapshotIsDue(
  lastSnapshotAt: number,
  now: number,
  intervalMs: number,
): boolean {
  return lastSnapshotAt === 0 || now - lastSnapshotAt >= intervalMs
}
