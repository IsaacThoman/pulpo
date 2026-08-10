import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { catalogIconModeSchema, type CatalogIconMode } from '@pulpo/contracts'
import { db } from '../database/client.js'
import { auditEvents, catalogIcons, labs, models } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { newId } from '../lib/ids.js'
import { getBlobStore } from '../storage/index.js'
import { createCatalogIconVariants } from './icon-assets.js'

export type CatalogIconRow = typeof catalogIcons.$inferSelect

export function catalogIconUrls(icon: Pick<CatalogIconRow, 'id' | 'mode'>) {
  const mode = catalogIconModeSchema.parse(icon.mode)
  return {
    id: icon.id,
    mode,
    lightUrl: `/api/catalog-icons/${icon.id}/${mode === 'original' ? 'original' : 'monochrome-light'}.png`,
    darkUrl: `/api/catalog-icons/${icon.id}/${mode === 'original' ? 'original' : 'monochrome-dark'}.png`,
  }
}

export async function requireCatalogIcon(id: string): Promise<CatalogIconRow> {
  const [icon] = await db.select().from(catalogIcons).where(eq(catalogIcons.id, id)).limit(1)
  if (!icon) throw notFound('Catalog icon')
  return icon
}

export async function listCatalogIcons() {
  const rows = await db.select().from(catalogIcons).orderBy(catalogIcons.createdAt)
  if (!rows.length) return []
  const [labUsage, modelUsage] = await Promise.all([
    db.select({ id: labs.customIconId, count: sql<number>`count(*)::int` })
      .from(labs).where(sql`${labs.customIconId} is not null`).groupBy(labs.customIconId),
    db.select({ id: models.customIconId, count: sql<number>`count(*)::int` })
      .from(models).where(sql`${models.customIconId} is not null`).groupBy(models.customIconId),
  ])
  const labCounts = new Map(labUsage.map((row) => [row.id, row.count]))
  const modelCounts = new Map(modelUsage.map((row) => [row.id, row.count]))
  return rows.map((icon) => {
    const labsCount = labCounts.get(icon.id) ?? 0
    const modelsCount = modelCounts.get(icon.id) ?? 0
    return {
      ...catalogIconUrls(icon),
      name: icon.name,
      usage: { labs: labsCount, models: modelsCount, total: labsCount + modelsCount },
      createdAt: icon.createdAt,
      updatedAt: icon.updatedAt,
    }
  })
}

export async function createCatalogIcon(input: {
  actorUserId: string
  name: string
  mode: CatalogIconMode
  bytes: Uint8Array
  mimeType: string
}): Promise<{ id: string }> {
  const name = z.string().trim().min(1).max(120).parse(input.name)
  const mode = catalogIconModeSchema.parse(input.mode)
  let variants
  try {
    variants = await createCatalogIconVariants(input.bytes, input.mimeType)
  } catch (cause) {
    throw new AppError(400, 'invalid_catalog_icon', cause instanceof Error ? cause.message : 'Catalog icon is invalid')
  }
  const id = newId()
  const keys = {
    original: `catalog-icons/${id}/original.png`,
    monochromeLight: `catalog-icons/${id}/monochrome-light.png`,
    monochromeDark: `catalog-icons/${id}/monochrome-dark.png`,
  }
  try {
    await Promise.all([
      getBlobStore().put(keys.original, variants.original, { contentType: 'image/png', contentLength: variants.original.byteLength }),
      getBlobStore().put(keys.monochromeLight, variants.monochromeLight, { contentType: 'image/png', contentLength: variants.monochromeLight.byteLength }),
      getBlobStore().put(keys.monochromeDark, variants.monochromeDark, { contentType: 'image/png', contentLength: variants.monochromeDark.byteLength }),
    ])
    await db.transaction(async (tx) => {
      await tx.insert(catalogIcons).values({
        id,
        name,
        mode,
        originalObjectKey: keys.original,
        monochromeLightObjectKey: keys.monochromeLight,
        monochromeDarkObjectKey: keys.monochromeDark,
        originalChecksum: variants.checksums.original,
        monochromeLightChecksum: variants.checksums.monochromeLight,
        monochromeDarkChecksum: variants.checksums.monochromeDark,
        createdByUserId: input.actorUserId,
      })
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId: input.actorUserId, action: 'catalog_icon.create', targetType: 'catalog_icon', targetId: id,
      })
    })
  } catch (cause) {
    await Promise.all(Object.values(keys).map((key) => getBlobStore().delete(key).catch(() => undefined)))
    throw cause
  }
  return { id }
}

export async function updateCatalogIcon(id: string, actorUserId: string, input: unknown): Promise<CatalogIconRow> {
  const body = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    mode: catalogIconModeSchema.optional(),
  }).refine((value) => value.name !== undefined || value.mode !== undefined, 'At least one field is required').parse(input)
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(catalogIcons).set({ ...body, updatedAt: new Date() }).where(eq(catalogIcons.id, id)).returning()
    if (rows[0]) await tx.insert(auditEvents).values({
      id: newId(), actorUserId, action: 'catalog_icon.update', targetType: 'catalog_icon', targetId: id,
    })
    return rows
  })
  if (!updated) throw notFound('Catalog icon')
  return updated
}

export async function deleteCatalogIcon(id: string, actorUserId: string): Promise<CatalogIconRow> {
  const icon = await requireCatalogIcon(id)
  const [usedLab, usedModel] = await Promise.all([
    db.select({ id: labs.id }).from(labs).where(eq(labs.customIconId, id)).limit(1),
    db.select({ id: models.id }).from(models).where(eq(models.customIconId, id)).limit(1),
  ])
  if (usedLab.length || usedModel.length) {
    throw new AppError(409, 'catalog_icon_in_use', 'Remove this icon from every lab and model before deleting it')
  }
  try {
    await db.transaction(async (tx) => {
      const deleted = await tx.delete(catalogIcons).where(and(eq(catalogIcons.id, id))).returning({ id: catalogIcons.id })
      if (!deleted.length) throw notFound('Catalog icon')
      await tx.insert(auditEvents).values({
        id: newId(), actorUserId, action: 'catalog_icon.delete', targetType: 'catalog_icon', targetId: id,
      })
    })
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23503') {
      throw new AppError(409, 'catalog_icon_in_use', 'Remove this icon from every lab and model before deleting it')
    }
    throw cause
  }
  return icon
}
