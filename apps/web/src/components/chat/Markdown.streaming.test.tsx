// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'

const { parseMarkdown } = vi.hoisted(() => ({ parseMarkdown: vi.fn() }))
vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>()
  return { ...actual, default: (props: Parameters<typeof actual.default>[0]) => {
    parseMarkdown(props.children)
    return actual.default(props)
  } }
})

afterEach(() => {
  cleanup()
  parseMarkdown.mockClear()
  vi.useRealTimers()
})

describe('Markdown streaming interactions', () => {
  it('parses only displayed text while chunks arrive between display ticks', () => {
    vi.useFakeTimers()
    const view = render(<Markdown content="Initial answer" streaming />)
    expect(parseMarkdown).toHaveBeenCalledTimes(1)

    for (let chunk = 1; chunk <= 20; chunk++) {
      view.rerender(<Markdown content={`Initial answer ${chunk}`} streaming />)
    }
    expect(parseMarkdown).toHaveBeenCalledTimes(1)
    expect(view.getByText('Initial answer')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(100) })
    expect(parseMarkdown).toHaveBeenCalledTimes(2)
    expect(view.getByText('Initial answer 20')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(200) })
    expect(parseMarkdown).toHaveBeenCalledTimes(2)

    view.rerender(<Markdown content="Completed answer" />)
    expect(view.getByText('Completed answer')).toBeTruthy()
    expect(parseMarkdown).toHaveBeenCalledTimes(3)
  })

  it('updates rendering options even when the displayed content is unchanged', () => {
    const content = 'One\nTwo\n\n[Link](https://example.com)'
    const view = render(<Markdown content={content} />)
    view.rerender(<Markdown content={content} breaks />)
    expect(view.container.querySelector('br')).toBeTruthy()
    view.rerender(<Markdown content={content} breaks caret />)
    expect(view.container.querySelector('.stream-caret')).toBeTruthy()
    const components = { p: ({ children }: { children?: ReactNode }) => <p data-custom>{children}</p> }
    view.rerender(<Markdown content={content} breaks caret components={components} />)
    expect(view.container.querySelector('[data-custom]')).toBeTruthy()
    view.rerender(<Markdown content={content} breaks caret components={components} urlTransform={() => 'https://changed.example/'} />)
    expect(view.getByRole('link').getAttribute('href')).toBe('https://changed.example/')
    expect(parseMarkdown).toHaveBeenCalledTimes(5)
  })

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
