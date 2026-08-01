import { AppError } from '../lib/errors.js'

export interface UsageCursor {
  createdAt: Date
  id: string
}

export function encodeUsageCursor(cursor: UsageCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id })).toString('base64url')
}

export function decodeUsageCursor(value: string): UsageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown }
    const createdAt = new Date(String(parsed.createdAt ?? ''))
    const id = String(parsed.id ?? '')
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid cursor')
    return { createdAt, id }
  } catch {
    throw new AppError(400, 'invalid_cursor', 'The usage cursor is invalid')
  }
}

export function publicParticipant(input: {
  visible: boolean
  name: string
  nickname: string | null
  color: string
}): { name: string; color: string | null; anonymous: boolean } {
  if (!input.visible) return { name: 'Anonymous', color: null, anonymous: true }
  return {
    name: input.nickname?.trim() || input.name,
    color: input.color,
    anonymous: false,
  }
}

export function publicModel(input: {
  visible: boolean
  id: string
  name: string
  logo: string | null
}): { id: string; name: string; logo: string | null } {
  return input.visible
    ? { id: input.id, name: input.name, logo: input.logo }
    : { id: 'other', name: 'Other', logo: null }
}
