import { describe, expect, it } from 'vitest'
import { friendRequestAction, orderedPair } from './routes.js'

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
})
