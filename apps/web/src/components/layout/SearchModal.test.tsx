// @vitest-environment jsdom
import { useEffect, useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { SearchModal } from './SearchModal'
import { focusComposer, registerComposerFocus } from '@/components/chat/composer-focus'

vi.mock('@/stores/chat', () => ({
  useChat: (select: (state: { chats: [] }) => unknown) => select({ chats: [] }),
}))
vi.mock('@/stores/catalog', () => ({ getCatalogModel: () => undefined }))
vi.mock('@/lib/api', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: [] })) }))

function Harness({ withComposer }: { withComposer: boolean }) {
  const [open, setOpen] = useState(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  useEffect(() => withComposer ? registerComposerFocus(() => composer.current?.focus()) : undefined, [withComposer])
  return (
    <MemoryRouter>
      {withComposer && <textarea ref={composer} aria-label="Composer" />}
      <button onClick={() => setOpen(true)}>Open search</button>
      {open && <SearchModal open={open} onClose={() => setOpen(false)} />}
    </MemoryRouter>
  )
}

afterEach(cleanup)

describe('SearchModal', () => {
  it('returns focus to the composer when dismissed with Escape', async () => {
    render(<Harness withComposer />)
    const trigger = screen.getByRole('button', { name: 'Open search' })
    trigger.focus()
    fireEvent.click(trigger)
    const input = await screen.findByPlaceholderText('Search chats and messages…')
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Composer' })))
  })

  it('does not steal focus when closed without Escape', async () => {
    const focus = vi.fn()
    const unregister = registerComposerFocus(focus)
    const { rerender } = render(<MemoryRouter><SearchModal open onClose={() => undefined} /></MemoryRouter>)
    await screen.findByPlaceholderText('Search chats and messages…')

    rerender(<MemoryRouter><SearchModal open={false} onClose={() => undefined} /></MemoryRouter>)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(focus).not.toHaveBeenCalled()
    unregister()
  })
})

describe('composer focus registry', () => {
  it('only clears the registration it owns', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unregisterFirst = registerComposerFocus(first)
    const unregisterSecond = registerComposerFocus(second)
    unregisterFirst()
    expect(focusComposer()).toBe(true)
    expect(second).toHaveBeenCalledOnce()
    unregisterSecond()
    expect(focusComposer()).toBe(false)
    expect(first).not.toHaveBeenCalled()
  })
})
