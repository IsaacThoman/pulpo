import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { shouldPersistQuery } from './query-persistence'

describe('query persistence policy', () => {
  it('never persists scoped administrator chat data', () => {
    expect(shouldPersistQuery({
      queryKey: ['chat', 'admin-chat:access-1', 'chat-1'],
      state: { status: 'success', data: { id: 'chat-1' } },
    })).toBe(false)
    expect(shouldPersistQuery({
      queryKey: ['chats', 'admin-chat:access-1'],
      state: { status: 'success', data: [] },
    })).toBe(false)
  })

  it('retains the existing owner query behavior', () => {
    expect(shouldPersistQuery({ queryKey: ['chat', 'owner-1'], state: { status: 'success', data: { temporary: false } } })).toBe(true)
    expect(shouldPersistQuery({ queryKey: ['chat', 'owner-1'], state: { status: 'success', data: { temporary: true } } })).toBe(false)
  })
})

it('retains cached data after transient refetch errors but not access failures', () => {
  const query = { queryKey: ['chat', 'owner', 'chat'], state: { status: 'error', data: { temporary: false }, error: new TypeError('offline') } }
  expect(shouldPersistQuery(query)).toBe(true)
  expect(shouldPersistQuery({ ...query, state: { ...query.state, error: new ApiError(503, 'unavailable', 'Unavailable') } })).toBe(true)
  expect(shouldPersistQuery({ ...query, state: { ...query.state, error: new ApiError(403, 'forbidden', 'Forbidden') } })).toBe(false)
  expect(shouldPersistQuery({ ...query, state: { ...query.state, data: undefined } })).toBe(false)
  expect(shouldPersistQuery({ ...query, state: { ...query.state, data: { temporary: true } } })).toBe(false)
})
