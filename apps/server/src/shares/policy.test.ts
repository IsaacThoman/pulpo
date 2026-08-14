import { getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ChatShareSnapshot } from '@pulpo/contracts'
import { chatShares } from '../database/schema.js'
import {
  snapshotReferencesAttachment,
  snapshotShareCanBeRevoked,
  snapshotShareIsActive,
  type SnapshotShareState,
} from './policy.js'

const now = new Date('2026-08-14T12:00:00.000Z')
const attachmentId = '00000000-0000-4000-8000-000000000041'
const snapshot: ChatShareSnapshot = {
  version: 1,
  sharedAt: now.toISOString(),
  chat: {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Snapshot',
    modelId: 'model-1',
    createdAt: now.toISOString(),
  },
  responses: [],
  attachments: [{ id: attachmentId, originalName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 42 }],
  models: [],
}

function share(overrides: Partial<SnapshotShareState> = {}): SnapshotShareState {
  return {
    userId: '00000000-0000-4000-8000-000000000002',
    encryptedToken: 'encrypted-token',
    snapshot,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  }
}

describe('share snapshot access policy', () => {
  it('accepts active shares and rejects expired, revoked, or legacy rows', () => {
    expect(snapshotShareIsActive(share(), now)).toBe(true)
    expect(snapshotShareIsActive(share({ expiresAt: new Date(now.getTime() - 1) }), now)).toBe(false)
    expect(snapshotShareIsActive(share({ expiresAt: new Date(now.getTime() + 1) }), now)).toBe(true)
    expect(snapshotShareIsActive(share({ revokedAt: now }), now)).toBe(false)
    expect(snapshotShareIsActive(share({ encryptedToken: null }), now)).toBe(false)
    expect(snapshotShareIsActive(share({ snapshot: null }), now)).toBe(false)
  })

  it('only allows an owner to revoke a still-active row', () => {
    expect(snapshotShareCanBeRevoked(share(), share().userId)).toBe(true)
    expect(snapshotShareCanBeRevoked(share(), '00000000-0000-4000-8000-000000000099')).toBe(false)
    expect(snapshotShareCanBeRevoked(share({ revokedAt: now }), share().userId)).toBe(false)
  })

  it('authorizes only attachments explicitly captured in the snapshot', () => {
    expect(snapshotReferencesAttachment(snapshot, attachmentId)).toBe(true)
    expect(snapshotReferencesAttachment(snapshot, '00000000-0000-4000-8000-000000000099')).toBe(false)
  })

  it('allows multiple snapshots per chat while keeping public tokens unique', () => {
    const config = getTableConfig(chatShares)
    expect(config.indexes.find((index) => index.config.name === 'share_token_unique')?.config.unique).toBe(true)
    expect(config.indexes.some((index) => index.config.unique && index.config.columns.some((column) => (
      'name' in column && column.name === 'chat_id'
    )))).toBe(false)
  })

  it('revokes all pre-snapshot rows during migration', () => {
    const migration = readFileSync(new URL('../../drizzle/0035_happy_frog_thor.sql', import.meta.url), 'utf8')
    expect(migration).toContain('UPDATE "chat_shares" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;')
  })
})
