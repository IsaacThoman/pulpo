// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Markdown streaming interactions', () => {
  it('preserves existing links and keyboard focus through chunks and stream completion', () => {
    vi.useFakeTimers()
    const content = '[Open docs](https://example.com)\n\nStreaming response'
    const view = render(<Markdown content={content} streaming />)
    const link = view.getByRole('link', { name: 'Open docs' })
    link.focus()

    for (const suffix of [' continues', ' continues with more text']) {
      view.rerender(<Markdown content={`${content}${suffix}`} streaming />)
      // Receiving a chunk must preserve the target even before the throttled render.
      expect(view.getByRole('link', { name: 'Open docs' })).toBe(link)
      expect(document.activeElement).toBe(link)

      act(() => { vi.advanceTimersByTime(100) })
      expect(view.getByText(`Streaming response${suffix}`)).toBeTruthy()
      expect(view.getByRole('link', { name: 'Open docs' })).toBe(link)
      expect(document.activeElement).toBe(link)
    }

    view.rerender(<Markdown content={`${content} finished`} streaming={false} />)
    expect(view.getByText('Streaming response finished')).toBeTruthy()
    expect(view.getByRole('link', { name: 'Open docs' })).toBe(link)
    expect(document.activeElement).toBe(link)
    expect(link.getAttribute('href')).toBe('https://example.com')
  })
})
