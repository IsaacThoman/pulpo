// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DocSyncStatus } from '@pulpo/client-core/doc-sync'
import { useSuggestionRecount } from './use-suggestion-recount'

const invalidateQueries = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }))
vi.mock('../api', () => ({ allFileChangesQueryKey: (userId: string) => ['files', userId, 'changes'] }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('waits through offline review and an unacknowledged upload, then recounts once', () => {
  const { result, rerender } = renderHook(({ status }: { status: DocSyncStatus }) => useSuggestionRecount('owner', status), { initialProps: { status: { state: 'offline' } as DocSyncStatus } })
  act(() => { result.current(); result.current() })
  expect(invalidateQueries).not.toHaveBeenCalled()
  rerender({ status: { state: 'syncing' } })
  expect(invalidateQueries).not.toHaveBeenCalled()
  rerender({ status: { state: 'synced' } })
  expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({ queryKey: ['files', 'owner', 'changes'] })
})

it('also recounts a review acknowledged synchronously', () => {
  const { result } = renderHook(() => useSuggestionRecount('owner', { state: 'synced' }))
  act(() => result.current())
  expect(invalidateQueries).toHaveBeenCalledTimes(1)
})
