import { describe, expect, it } from 'vitest'
import { shouldPersistQuery } from './query-persistence'

describe('query persistence', () => {
  it('never dehydrates temporary chat details or summaries', () => {
    expect(shouldPersistQuery({
      queryKey: ['chat', 'user', 'temporary'],
      state: { status: 'success', data: { temporary: true } },
    })).toBe(false)
    expect(shouldPersistQuery({
      queryKey: ['chats', 'user'],
      state: { status: 'success', data: [{ id: 'saved', temporary: false }, { id: 'temporary', temporary: true }] },
    })).toBe(false)
  })

  it('keeps successful permanent chat data', () => {
    expect(shouldPersistQuery({
      queryKey: ['chat', 'user', 'saved'],
      state: { status: 'success', data: { temporary: false } },
    })).toBe(true)
    expect(shouldPersistQuery({ queryKey: ['models'], state: { status: 'pending' } })).toBe(false)
  })

  it('does not persist admin billing data', () => {
    expect(shouldPersistQuery({
      queryKey: ['admin-billing-v2', '30d'],
      state: { status: 'success', data: { stripe: { mode: 'live' } } },
    })).toBe(false)
    expect(shouldPersistQuery({
      queryKey: ['admin-billing-settings'],
      state: { status: 'success', data: { eightWeeklyLimitMicros: 3_000_000 } },
    })).toBe(false)
  })
})
