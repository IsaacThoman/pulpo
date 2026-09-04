import { randomToken } from '../lib/crypto.js'
import { redis } from '../redis.js'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../database/client.js'
import { noteMemberships } from '../database/schema.js'

const LOCK_TTL_MS = 30_000

export interface NoteSourceLock {
  userId: string
  sessionId: string
  token: string
  expiresAt: string
}

const keyFor = (noteId: string) => `pulpo:note:${noteId}:source-lock`

export async function readNoteSourceLock(noteId: string): Promise<NoteSourceLock | null> {
  const value = await redis.get(keyFor(noteId))
  if (!value) return null
  try {
    return JSON.parse(value) as NoteSourceLock
  } catch {
    return null
  }
}

export async function readActiveNoteSourceLock(noteId: string): Promise<NoteSourceLock | null> {
  const lock = await readNoteSourceLock(noteId)
  if (!lock) return null
  const [membership] = await db.select({ role: noteMemberships.role }).from(noteMemberships).where(and(
    eq(noteMemberships.noteId, noteId),
    eq(noteMemberships.userId, lock.userId),
    inArray(noteMemberships.role, ['owner', 'editor']),
  )).limit(1)
  if (membership) return lock
  await releaseNoteSourceLock(noteId, lock.token)
  return null
}

export async function acquireNoteSourceLock(noteId: string, userId: string, sessionId: string): Promise<NoteSourceLock | null> {
  const lock: NoteSourceLock = {
    userId,
    sessionId,
    token: randomToken(24),
    expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
  }
  const acquired = await redis.set(keyFor(noteId), JSON.stringify(lock), 'PX', LOCK_TTL_MS, 'NX')
  return acquired === 'OK' ? lock : null
}

export async function renewNoteSourceLock(noteId: string, token: string): Promise<NoteSourceLock | null> {
  const key = keyFor(noteId)
  const current = await readNoteSourceLock(noteId)
  if (!current || current.token !== token) return null
  const next = { ...current, expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString() }
  const result = await redis.eval(
    `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]); return 1 else return 0 end`,
    1,
    key,
    JSON.stringify(current),
    JSON.stringify(next),
    String(LOCK_TTL_MS),
  )
  return result === 1 ? next : null
}

export async function releaseNoteSourceLock(noteId: string, token: string): Promise<boolean> {
  const key = keyFor(noteId)
  const current = await redis.get(key)
  if (!current) return false
  let parsed: NoteSourceLock
  try {
    parsed = JSON.parse(current) as NoteSourceLock
  } catch {
    return false
  }
  if (parsed.token !== token) return false
  const result = await redis.eval(
    `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
    1,
    key,
    current,
  )
  return result === 1
}
