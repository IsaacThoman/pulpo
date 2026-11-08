// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileToasts } from './FileToasts'
import { useFileToasts } from './toasts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useFileToasts.setState({ toasts: [] })
})

describe('file toasts', () => {
  it('keeps the live region mounted before the first toast, so that toast is announced', () => {
    const view = render(<FileToasts />)
    const region = view.container.querySelector('[aria-live="polite"]')
    expect(region).not.toBeNull()
    act(() => { useFileToasts.getState().show({ message: 'Moved to trash' }) })
    expect(view.container.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region!.textContent).toContain('Moved to trash')
  })

  it('pauses while the keyboard is on Undo, as while hovered', () => {
    vi.useFakeTimers()
    render(<FileToasts />)
    act(() => { useFileToasts.getState().show({ message: 'Moved to trash', undo: async () => undefined }) })
    const undo = screen.getByRole('button', { name: 'Undo' })
    fireEvent.focus(undo)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.queryByText('Moved to trash')).not.toBeNull()
    fireEvent.blur(undo)
    act(() => { vi.advanceTimersByTime(6_000) })
    expect(screen.queryByText('Moved to trash')).toBeNull()
  })
})
