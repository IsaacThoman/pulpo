// @vitest-environment jsdom
import { useEffect, useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { SearchModal } from './SearchModal'
import { focusComposer, registerComposerFocus } from '@/components/chat/composer-focus'

const fixture = vi.hoisted(() => ({ chats: [] as unknown[] }))
vi.mock('@/stores/chat', () => ({
  useChat: (select: (state: { chats: unknown[] }) => unknown) => select({ chats: fixture.chats }),
}))
vi.mock('@/stores/catalog', () => ({ getCatalogModel: () => undefined }))
vi.mock('@/components/ModelIcon', () => ({ ModelIcon: () => null }))
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

afterEach(() => {
  cleanup()
  fixture.chats = []
})

function chat(id: string, title: string, updatedAt: number) {
  return { id, title, modelId: 'model', messages: [], updatedAt, createdAt: updatedAt, temporary: false }
}

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

describe('SearchModal combobox', () => {
  it('exposes the highlighted result to assistive technology', async () => {
    fixture.chats = [chat('a', 'Lisbon trip', 3), chat('b', 'Lisbon food', 2), chat('c', 'Octopus facts', 1)]
    render(<MemoryRouter><SearchModal open onClose={() => undefined} /></MemoryRouter>)

    expect(screen.getByRole('dialog', { name: 'Search chats' })).toBeDefined()
    const input = screen.getByRole('combobox', { name: 'Search chats and messages' })
    const listbox = screen.getByRole('listbox')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const options = screen.getAllByRole('option')
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id)
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id)
    expect(options[1]!.getAttribute('aria-selected')).toBe('true')
    expect(options[0]!.getAttribute('aria-selected')).toBe('false')

    fireEvent.change(input, { target: { value: 'lisbon' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 results'))

    fireEvent.change(input, { target: { value: 'nothing matches' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No results'))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
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
