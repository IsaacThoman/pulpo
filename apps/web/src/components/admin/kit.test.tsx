// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SaveBar } from './kit'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

function mount(onSave: () => void | Promise<void>) {
  return render(<StrictMode><SaveBar onSave={onSave} /></StrictMode>)
}

it('shows saved confirmation for 1500 ms, then restores the save action', async () => {
  const view = mount(vi.fn())
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
  expect(view.getByRole('button', { name: 'Saved ✓' })).toBeTruthy()
  act(() => { vi.advanceTimersByTime(1499) })
  expect(view.getByRole('button', { name: 'Saved ✓' })).toBeTruthy()
  act(() => { vi.advanceTimersByTime(1) })
  expect(view.getByRole('button', { name: 'Save' })).toBeTruthy()
})

it('cancels the pending confirmation reset when unmounted', async () => {
  const view = mount(vi.fn())
  const initialTimers = vi.getTimerCount()
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
  expect(vi.getTimerCount()).toBe(initialTimers + 1)
  view.unmount()
  expect(vi.getTimerCount()).toBe(initialTimers)
})

it.each(['resolve', 'reject'] as const)('does not schedule work when an unmounted save later %ss', async (settlement) => {
  const pending = deferred()
  const view = mount(() => pending.promise)
  fireEvent.click(view.getByRole('button', { name: 'Save' }))
  expect(view.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)
  view.unmount()
  const initialTimers = vi.getTimerCount()
  await act(async () => {
    if (settlement === 'resolve') pending.resolve()
    else pending.reject(new Error('save failed after leaving'))
  })
  expect(vi.getTimerCount()).toBe(initialTimers)
})

it('does not let an earlier confirmation reset interrupt a later save', async () => {
  const pending = deferred()
  const onSave = vi.fn<() => void | Promise<void>>().mockReturnValueOnce(undefined).mockReturnValueOnce(pending.promise)
  const view = mount(onSave)
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
  act(() => { vi.advanceTimersByTime(1000) })
  fireEvent.click(view.getByRole('button', { name: 'Saved ✓' }))
  act(() => { vi.advanceTimersByTime(500) })
  expect(view.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)
  await act(async () => { pending.resolve() })
  act(() => { vi.advanceTimersByTime(1499) })
  expect(view.getByRole('button', { name: 'Saved ✓' })).toBeTruthy()
  act(() => { vi.advanceTimersByTime(1) })
  expect(view.getByRole('button', { name: 'Save' })).toBeTruthy()
})

it('prevents concurrent saves and allows retry after a failure', async () => {
  const pending = deferred()
  const onSave = vi.fn<() => void | Promise<void>>().mockReturnValueOnce(pending.promise).mockReturnValueOnce(undefined)
  const view = mount(onSave)
  const button = view.getByRole('button', { name: 'Save' })
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  expect(onSave).toHaveBeenCalledOnce()
  await act(async () => { pending.reject(new Error('save failed')) })
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save failed — retry' })) })
  expect(onSave).toHaveBeenCalledTimes(2)
  expect(view.getByRole('button', { name: 'Saved ✓' })).toBeTruthy()
})
