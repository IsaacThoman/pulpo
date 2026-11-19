import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  INSTANCE_COLOR_THEMES_SETTING_KEY,
  instanceColorThemesSchema,
  instanceColorThemesSnapshotSchema,
  type InstanceColorThemesSnapshot,
} from '@pulpo/contracts'
import { requireAdmin, requireUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { applicationSettings, auditEvents } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { newId } from '../lib/ids.js'

export function parseInstanceColorThemes(value: unknown) {
  return instanceColorThemesSchema.catch([]).parse(value)
}

function snapshot(value: unknown): InstanceColorThemesSnapshot {
  const themes = parseInstanceColorThemes(value)
  const revision = createHash('sha256').update(JSON.stringify(themes)).digest('base64url')
  return { themes, revision }
}

export function registerInstanceColorThemeRoutes(app: FastifyInstance): void {
  app.get('/api/interface/color-themes', async (request) => {
    requireUser(request)
    const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, INSTANCE_COLOR_THEMES_SETTING_KEY)).limit(1)
    return snapshot(row?.value)
  })

  app.put('/api/admin/settings/color-themes', async (request) => {
    const admin = requireAdmin(request)
    const { themes, revision } = instanceColorThemesSnapshotSchema.parse(request.body)
    return db.transaction(async (tx) => {
      // Serialize with CLI settings apply so an open editor cannot overwrite a newer catalog.
      await tx.execute(sql`select pg_advisory_xact_lock(1886747744)`)
      const key = INSTANCE_COLOR_THEMES_SETTING_KEY
      const [existing] = await tx.select({ value: applicationSettings.value }).from(applicationSettings)
        .where(eq(applicationSettings.key, key)).limit(1)
      if (snapshot(existing?.value).revision !== revision) {
        throw new AppError(409, 'color_themes_conflict', 'Instance themes changed. Reload them before saving.')
      }
      const [saved] = await tx.insert(applicationSettings).values({ key, value: themes, updatedBy: admin.id })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value: themes, updatedBy: admin.id, updatedAt: new Date() } })
        .returning({ value: applicationSettings.value })
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: admin.id, action: 'settings.update', targetType: 'application', metadata: { keys: [key] },
      })
      return snapshot(saved!.value)
    })
  })
}
