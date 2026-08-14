import { describe, expect, it } from 'vitest'
import { friendRequestAction, friendSearchRelationship, orderedPair } from './routes.js'

describe('friend pair identity', () => {
  it('normalizes either request direction to the same pair', () => {
    const first = '11111111-1111-4111-8111-111111111111'
    const second = '22222222-2222-4222-8222-222222222222'
    expect(orderedPair(first, second)).toEqual([first, second])
    expect(orderedPair(second, first)).toEqual([first, second])
  })

  it('keeps duplicate requests and auto-accepts reciprocal requests', () => {
    expect(friendRequestAction(undefined, 'requester')).toBe('create')
    expect(friendRequestAction({ status: 'pending', requestedByUserId: 'requester' }, 'requester')).toBe('keep')
    expect(friendRequestAction({ status: 'accepted', requestedByUserId: 'other' }, 'requester')).toBe('keep')
    expect(friendRequestAction({ status: 'pending', requestedByUserId: 'other' }, 'requester')).toBe('accept')
  })

  it('maps every searchable relationship state', () => {
    expect(friendSearchRelationship('me', 'me', null)).toBe('self')
    expect(friendSearchRelationship('other', 'me', null)).toBe('none')
    expect(friendSearchRelationship('other', 'me', { status: 'pending', requestedByUserId: 'other' })).toBe('incoming')
    expect(friendSearchRelationship('other', 'me', { status: 'pending', requestedByUserId: 'me' })).toBe('outgoing')
    expect(friendSearchRelationship('other', 'me', { status: 'accepted', requestedByUserId: 'other' })).toBe('friends')
  })
})
