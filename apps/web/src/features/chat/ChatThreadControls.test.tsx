// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RelatedChat, RelatedChats } from '@pulpo/contracts'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  })
})
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const { ChatContextLine, ThreadsMenu } = await import('./ChatThreadControls')

afterEach(cleanup)

function related(id: string, overrides: Partial<RelatedChat> = {}): RelatedChat {
  return { id, kind: 'thread', title: id, createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z', status: 'working', summary: null, ...overrides }
}

const empty: RelatedChats = { origin: null, sideChats: [], threads: [], project: null }

describe('ChatContextLine', () => {
  it('links a side chat back to the chat it came from', () => {
    const onOpenChat = vi.fn()
    render(<ChatContextLine kind="side" related={{ ...empty, origin: { id: 'origin', kind: 'chat', title: 'Trip plans', deleted: false } }} threadStatus={null} onOpenChat={onOpenChat} />)
    expect(screen.getByText('Side chat from')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open "Trip plans"' }))
    expect(onOpenChat).toHaveBeenCalledWith('origin')
  })

  it('shows a thread’s status and a deleted origin without a link', () => {
    render(<ChatContextLine kind="thread" related={{ ...empty, origin: { id: 'origin', kind: 'chat', title: 'Old chat', deleted: true } }} threadStatus="attention" onOpenChat={vi.fn()} />)
    expect(screen.getByText('Thread from')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open "Old chat"' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Needs attention')
  })

  it('says nothing for an ordinary chat outside a project', () => {
    const view = render(<ChatContextLine kind="chat" related={empty} threadStatus={null} onOpenChat={vi.fn()} />)
    expect(view.container.textContent).toBe('')
  })
})

describe('ThreadsMenu', () => {
  it('counts threads and side chats, flags attention, and lists them by status', async () => {
    const onOpenChat = vi.fn()
    render(<TooltipProvider><ThreadsMenu
      related={{
        ...empty,
        threads: [related('a', { title: 'Research', status: 'attention', summary: 'Hit a paywall' }), related('b', { title: 'Draft', status: 'done' })],
        sideChats: [related('s', { kind: 'side', title: 'Quick question', status: null })],
      }}
      onOpenChat={onOpenChat}
    /></TooltipProvider>)
    const trigger = screen.getByRole('button', { name: 'Threads and side chats (a thread needs attention)' })
    expect(trigger.textContent).toBe('3')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = await screen.findByRole('menu')
    expect([...menu.querySelectorAll('[role="group"]')].map((group) => group.getAttribute('aria-label'))).toEqual(['Needs attention', 'Done', 'Side chats'])
    expect(menu.textContent).toContain('Hit a paywall')
    fireEvent.click(screen.getByRole('menuitem', { name: /Quick question/ }))
    expect(onOpenChat).toHaveBeenCalledWith('s')
  })

  it('stays hidden while a chat has neither', () => {
    const view = render(<TooltipProvider><ThreadsMenu related={empty} onOpenChat={vi.fn()} /></TooltipProvider>)
    expect(view.container.textContent).toBe('')
  })
})
