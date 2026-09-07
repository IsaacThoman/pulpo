import Bowser from 'bowser'
import { and, desc, eq, gt, ne, type SQL } from 'drizzle-orm'
import { sessionAppTypeSchema, sessionPlatformSchema, type DeviceSession } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { auditEvents, sessions } from '../database/schema.js'
import { newId } from '../lib/ids.js'
import { publishSessionRevocation } from '../responses/events.js'

type Session = typeof sessions.$inferSelect

export function serializeDeviceSession(row: Session, currentId: string): DeviceSession {
  const parsed = Bowser.parse(row.userAgent || 'Unknown')
  const os = parsed.os.name?.toLowerCase() ?? ''
  const detectedPlatform = os.includes('ios') ? 'ios' : os.includes('android') ? 'android'
    : os.includes('windows') ? 'windows' : os.includes('mac') ? 'macos' : os.includes('linux') ? 'linux' : 'unknown'
  const platform = sessionPlatformSchema.safeParse(row.platform).data ?? detectedPlatform
  // Old desktop clients used the Mac label on Windows too: prefer the UA for OS.
  const legacyApp = row.deviceLabel === 'Pulpo CLI' ? 'cli'
    : row.deviceLabel === 'Pulpo for Mac' || row.userAgent?.includes('Electron/') ? 'desktop'
      : row.deviceLabel ? (platform === 'ios' || platform === 'android' || row.deviceLabel === 'Pulpo Mobile' ? 'mobile' : 'unknown') : parsed.browser.name ? 'web' : 'unknown'
  const appType = sessionAppTypeSchema.safeParse(row.appType).data ?? legacyApp
  const platformLabel = { ios: 'iOS', android: 'Android', windows: 'Windows', macos: 'Mac', linux: 'Linux', unknown: 'Unknown platform' }[platform]
  const browser = appType === 'web' ? parsed.browser.name ?? null : null
  const deviceLabel = appType === 'desktop' && (!row.deviceLabel || row.deviceLabel === 'Pulpo for Mac')
    ? platform === 'unknown' ? 'Pulpo Desktop' : `Pulpo for ${platformLabel}`
    : row.deviceLabel ?? (browser ? `${browser} on ${platformLabel}` : 'Unknown device')
  return {
    id: row.id, deviceLabel, appType, platform, browser,
    signInIp: row.ipAddress, latestIp: row.latestIpAddress,
    createdAt: row.createdAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), isCurrent: row.id === currentId,
  }
}

export async function listDeviceSessions(userId: string, currentId: string) {
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt))
  return { sessions: rows.map((row) => serializeDeviceSession(row, currentId)).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)) }
}

export type SessionRevocation = { kind: 'one'; sessionId: string } | { kind: 'others'; currentId: string } | { kind: 'all' }

export async function revokeDeviceSessions(actorId: string, userId: string, input: SessionRevocation): Promise<string[]> {
  const filters: SQL[] = [eq(sessions.userId, userId)]
  if (input.kind === 'one') filters.push(eq(sessions.id, input.sessionId))
  if (input.kind === 'others') filters.push(ne(sessions.id, input.currentId))
  const ids = await db.transaction(async (tx) => {
    const deleted = await tx.delete(sessions).where(and(...filters)).returning({ id: sessions.id })
    const sessionIds = deleted.map((row) => row.id)
    if (sessionIds.length) await tx.insert(auditEvents).values({
      id: newId(), actorUserId: actorId, action: `session.revoke.${input.kind}`, targetType: 'user', targetId: userId,
      metadata: { sessionIds, count: sessionIds.length },
    })
    return sessionIds
  })
  // Publish on retries too: a previous attempt may have committed before Redis failed.
  await publishSessionRevocation(userId)
  return ids
}
