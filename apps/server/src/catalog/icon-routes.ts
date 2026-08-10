import type { FastifyInstance, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireAdmin } from '../auth/service.js'
import { db } from '../database/client.js'
import { catalogIcons } from '../database/schema.js'
import { AppError, notFound } from '../lib/errors.js'
import { getBlobStore } from '../storage/index.js'
import { CATALOG_ICON_MAX_BYTES } from './icon-assets.js'
import {
  createCatalogIcon,
  deleteCatalogIcon,
  listCatalogIcons,
  updateCatalogIcon,
} from './icon-service.js'
import { catalogIconModeSchema } from '@pulpo/contracts'

function multipartField(part: Awaited<ReturnType<FastifyRequest['file']>>, name: string): string {
  const field = part?.fields[name]
  return String(field && !Array.isArray(field) && field.type === 'field' ? field.value : '')
}

export async function readCatalogIconUpload(request: FastifyRequest) {
  try {
    const part = await request.file({ limits: { fileSize: CATALOG_ICON_MAX_BYTES, files: 1 } })
    if (!part) throw new AppError(400, 'catalog_icon_file_required', 'Choose an image to upload')
    const bytes = await part.toBuffer()
    if (part.file.truncated) throw new AppError(413, 'catalog_icon_too_large', 'Catalog icons may be at most 2 MiB')
    const fallbackName = part.filename.replace(/\.[^.]+$/, '').trim()
    return {
      name: multipartField(part, 'name').trim() || fallbackName,
      mode: catalogIconModeSchema.parse(multipartField(part, 'mode').trim() || 'original'),
      bytes,
      mimeType: part.mimetype,
    }
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new AppError(413, 'catalog_icon_too_large', 'Catalog icons may be at most 2 MiB')
    }
    throw cause
  }
}

export async function registerCatalogIconRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/catalog-icons/:id/:variant.png', async (request, reply) => {
    const { id, variant } = z.object({
      id: z.uuid(),
      variant: z.enum(['original', 'monochrome-light', 'monochrome-dark']),
    }).parse(request.params)
    const [icon] = await db.select().from(catalogIcons).where(eq(catalogIcons.id, id)).limit(1)
    if (!icon) throw notFound('Catalog icon')
    const selected = variant === 'original'
      ? { key: icon.originalObjectKey, checksum: icon.originalChecksum }
      : variant === 'monochrome-light'
        ? { key: icon.monochromeLightObjectKey, checksum: icon.monochromeLightChecksum }
        : { key: icon.monochromeDarkObjectKey, checksum: icon.monochromeDarkChecksum }
    const etag = `"${selected.checksum}"`
    reply.header('cache-control', 'public, max-age=31536000, immutable').header('etag', etag)
    if (request.headers['if-none-match'] === etag) return reply.code(304).send()
    return reply.type('image/png').send(Buffer.from(await getBlobStore().get(selected.key)))
  })

  app.get('/api/admin/catalog-icons', async (request) => {
    requireAdmin(request)
    return { data: await listCatalogIcons() }
  })

  app.post('/api/admin/catalog-icons', async (request, reply) => {
    const admin = requireAdmin(request)
    const upload = await readCatalogIconUpload(request)
    const created = await createCatalogIcon({ actorUserId: admin.id, ...upload })
    reply.code(201)
    return created
  })

  app.patch('/api/admin/catalog-icons/:id', async (request) => {
    const admin = requireAdmin(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    return updateCatalogIcon(id, admin.id, request.body)
  })

  app.delete('/api/admin/catalog-icons/:id', async (request, reply) => {
    const admin = requireAdmin(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const deleted = await deleteCatalogIcon(id, admin.id)
    await Promise.all([
      getBlobStore().delete(deleted.originalObjectKey).catch((cause) => request.log.warn({ err: cause, iconId: id }, 'Catalog icon cleanup failed')),
      getBlobStore().delete(deleted.monochromeLightObjectKey).catch((cause) => request.log.warn({ err: cause, iconId: id }, 'Catalog icon cleanup failed')),
      getBlobStore().delete(deleted.monochromeDarkObjectKey).catch((cause) => request.log.warn({ err: cause, iconId: id }, 'Catalog icon cleanup failed')),
    ])
    reply.code(204).send()
  })
}
