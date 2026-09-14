export interface StoredDiagnosticPolicy { enabled: boolean; epoch: number; retentionSeconds: number | null; expiredBefore: Date | null }
export function diagnosticPayloadAvailability(row: { captureDetailedPayloads: boolean; payloadEpoch: number; payloadExpiresAt: Date | null; retentionStartedAt: Date; createdAt: Date }, policy: StoredDiagnosticPolicy | undefined, now = new Date()) {
  const expiry = Math.min(row.payloadExpiresAt?.getTime() ?? Infinity,
    policy?.retentionSeconds == null ? Infinity : row.retentionStartedAt.getTime() + policy.retentionSeconds * 1000,
    row.createdAt.getTime() + 90 * 86_400_000)
  return { expiresAt: new Date(expiry), active: !!policy?.enabled && row.captureDetailedPayloads && row.payloadEpoch === policy.epoch && expiry > now.getTime() && (!policy.expiredBefore || row.retentionStartedAt > policy.expiredBefore) }
}
