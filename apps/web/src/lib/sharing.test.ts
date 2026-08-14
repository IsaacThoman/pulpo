import { describe, expect, it } from 'vitest'
import type { ChatShareSummary } from '@pulpo/contracts'
import { addCreatedShare, publicShareUrl, removeRevokedShare, sharingMenuLabel } from './sharing'

function summary(id: string, token: string): ChatShareSummary {
  return {
    id,
    chatId: '00000000-0000-4000-8000-000000000001',
    token,
    createdAt: '2026-08-14T12:00:00.000Z',
    expiresAt: null,
    responseCount: 2,
  }
}

describe('sharing presentation state', () => {
  it('switches the chat action when at least one snapshot is active', () => {
    expect(sharingMenuLabel(false)).toBe('Share')
    expect(sharingMenuLabel(true)).toBe('Manage sharing')
  })

  it('builds the exact token-scoped preview URL', () => {
    expect(publicShareUrl('https://pulpo.example/', 'token/with spaces')).toBe(
      'https://pulpo.example/share/token%2Fwith%20spaces',
    )
  })

  it('adds new snapshots newest-first and removes revoked snapshots immediately', () => {
    const first = summary('00000000-0000-4000-8000-000000000011', 'a'.repeat(32))
    const second = summary('00000000-0000-4000-8000-000000000012', 'b'.repeat(32))
    expect(addCreatedShare([first], second)).toEqual([second, first])
    expect(removeRevokedShare([second, first], second.id)).toEqual([first])
  })
})
