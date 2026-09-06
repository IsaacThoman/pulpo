import { QueryClient, dehydrate } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { restoreQueryCache, splitQueryCache } from './query-cache-records'
import { shouldPersistQuery } from '../query-persistence'

function fixture() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  const snapshot = () => ({ buster: 'test', timestamp: 1, clientState: dehydrate(queryClient, { shouldDehydrateQuery: shouldPersistQuery }) })
  queryClient.setQueryData(['chat', 'user', 'a'], { id: 'a', text: 'first response', temporary: false })
  queryClient.setQueryData(['chat', 'user', 'b'], { id: 'b', text: 'second response', temporary: false })
  return { queryClient, snapshot }
}

it('round-trips legacy and separate records, writing only changed bodies', () => {
  const { queryClient, snapshot } = fixture()
  const original = snapshot()
  expect(restoreQueryCache(original, new Map())).toEqual(original)
  const first = splitQueryCache(original, 'account-a', new Map())
  expect(first.changed.size).toBe(2)
  expect(first.envelope.clientState.queries.every((query) => query.state.data === undefined)).toBe(true)
  expect(restoreQueryCache(first.envelope, first.data)).toEqual(original)
  queryClient.setQueryData(['settings', 'user'], { theme: 'dark' })
  const unrelated = splitQueryCache(snapshot(), 'account-a', first.data)
  expect(unrelated.changed.size).toBe(0)
  queryClient.setQueryData(['chat', 'user', 'a'], { id: 'a', text: 'completed response', temporary: false })
  const terminal = splitQueryCache(snapshot(), 'account-a', unrelated.data)
  expect(terminal.changed.size).toBe(1)
  expect(restoreQueryCache(terminal.envelope, terminal.data)).toEqual(snapshot())
})

it('does not mix instances, retain removed chats, or hydrate missing bodies', () => {
  const { queryClient, snapshot } = fixture()
  const first = splitQueryCache(snapshot(), 'instance-one', new Map())
  const other = splitQueryCache(snapshot(), 'instance-two', first.data)
  expect(other.changed.size).toBe(2)
  expect([...other.data.keys()].some((key) => first.data.has(key))).toBe(false)
  queryClient.removeQueries({ queryKey: ['chat', 'user', 'a'] })
  const deleted = splitQueryCache(snapshot(), 'instance-one', first.data)
  expect(deleted.data.size).toBe(1)
  expect(restoreQueryCache(deleted.envelope, new Map()).clientState.queries).toEqual([])
})

it('keeps temporary and administrator details out of the persisted records', () => {
  const { queryClient, snapshot } = fixture()
  queryClient.setQueryData(['chat', 'user', 'temporary'], { temporary: true })
  queryClient.setQueryData(['chat', 'admin-chat:gate', 'private'], { text: 'private' })
  expect(splitQueryCache(snapshot(), 'instance', new Map()).data.size).toBe(2)
})

it('restores the last successful body after a transient failed refetch', () => {
  const { queryClient, snapshot } = fixture()
  const first = splitQueryCache(snapshot(), 'account-a', new Map())
  queryClient.getQueryCache().find({ queryKey: ['chat', 'user', 'a'] })!.setState({ status: 'error', error: new TypeError('offline') })
  const failed = splitQueryCache(snapshot(), 'account-a', first.data)
  expect(failed.changed.size).toBe(0)
  const restored = restoreQueryCache(failed.envelope, failed.data)
  const chat = restored.clientState.queries.find((query) => query.queryKey[2] === 'a')!
  expect(chat.state.status).toBe('success')
  expect(chat.state.error).toBeNull()
  expect(chat.state.data).toEqual({ id: 'a', text: 'first response', temporary: false })
})
