import type { FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { fileNameError, normalizeFileName } from '@pulpo/contracts'
import { requireUser, type AuthenticatedUser } from '../auth/service.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { parseAuthSettings } from '../settings/application-settings.js'
import { fileNameMessage } from './names.js'

/** Surfaces the specific name rule instead of a generic validation error. */
export function parseFileInput<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (parsed.success) return parsed.data
  const name = (body as { name?: unknown } | null)?.name
  const nameError = typeof name === 'string' ? fileNameError(normalizeFileName(name)) : null
  if (nameError) throw new AppError(400, `file_name_${nameError}`, fileNameMessage(nameError), 'invalid_request_error', 'name')
  throw parsed.error
}

export async function filesFeatureEnabled(): Promise<boolean> {
  const [setting] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'auth')).limit(1)
  return parseAuthSettings(setting?.value).filesEnabled
}

export async function requireFilesUser(request: FastifyRequest): Promise<AuthenticatedUser> {
  const user = requireUser(request)
  if (!await filesFeatureEnabled()) {
    throw new AppError(403, 'files_disabled', 'Files are disabled by the administrator', 'permission_error')
  }
  return user
}
