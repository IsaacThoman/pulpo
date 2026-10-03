// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ChatRow } from './Sidebar'
import type { Chat } from '@/lib/types'

const renameChat = vi.fn()
const chatState = { streamingIds: [] as string[], responseChatIds: {} as Record<string, string>, folders: [], renameChat }
vi.mock('@/stores/chat', () => ({ useChat: (select: (state: typeof chatState) => unknown) => select(chatState) }))
vi.mock('@/stores/settings', () => {
  const settings = { trashRetention: '30d', composerSyncEnabled: false }
  return {
    useSettings: Object.assign((select: (state: typeof settings) => unknown) => select(settings), {
      getState: () => settings,
      subscribe: () => () => undefined,
    }),
  }
})

const chat: Chat = {
  id: 'chat-1',
  title: 'Sorting Algorithms',
  modelId: 'model',
  messages: [],
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  folderId: null,
  sortOrder: 0,
  tags: [],
  temporary: false,
  expiresAt: null,
  expired: false,
}

function Location() {
  return <output>{useLocation().pathname}</output>
}

function mount(props: Partial<Parameters<typeof ChatRow>[0]> = {}) {
  const onNavigate = vi.fn()
  render(<MemoryRouter initialEntries={['/']}>
    <ChatRow chat={chat} active={false} shiftHeld={false} onNavigate={onNavigate} {...props} />
    <Routes><Route path="*" element={<Location />} /></Routes>
  </MemoryRouter>)
  return { onNavigate, link: screen.getByRole('link', { name: chat.title }) }
}

afterEach(() => {
  cleanup()
  renameChat.mockReset()
  Reflect.deleteProperty(window, 'pulpoDesktop')
})

describe('ChatRow', () => {
  it('renders the chat as a link so browsers can open it in a new tab', () => {
    const { link } = mount()
    expect(link.getAttribute('href')).toBe('/c/chat-1')
  })

  it('navigates in place on a plain click', () => {
    const { link, onNavigate } = mount()
    fireEvent.click(link)
    expect(screen.getByRole('status').textContent).toBe('/c/chat-1')
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('leaves modifier clicks to the browser', () => {
    const { link, onNavigate } = mount()
    let browserHandled = false
    // Record whether the browser's default (open in new tab) would run, then stop jsdom from navigating.
    const intercept = (e: MouseEvent) => {
      browserHandled = !e.defaultPrevented
      e.preventDefault()
    }
    document.addEventListener('click', intercept)
    fireEvent.click(link, { metaKey: true })
    document.removeEventListener('click', intercept)
    expect(browserHandled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('/')
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('navigates in place on modifier clicks in the desktop app', () => {
    Object.defineProperty(window, 'pulpoDesktop', { configurable: true, value: { os: 'darwin' } })
    const { link, onNavigate } = mount()
    fireEvent.click(link, { ctrlKey: true })
    expect(screen.getByRole('status').textContent).toBe('/c/chat-1')
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('ignores the click that ends a drag', () => {
    const didDragRef = { current: true }
    const { link, onNavigate } = mount({ didDragRef, draggable: true })
    expect(link.getAttribute('draggable')).toBe('false')
    fireEvent.click(link)
    expect(screen.getByRole('status').textContent).toBe('/')
    expect(onNavigate).not.toHaveBeenCalled()
    expect(didDragRef.current).toBe(false)
  })

  it('renames the chat inline from its menu', async () => {
    const { link } = mount()
    fireEvent.contextMenu(link)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename chat' }) as HTMLInputElement
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: '  Merge Sort  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameChat).toHaveBeenCalledWith('chat-1', 'Merge Sort')
    expect(screen.getByRole('link', { name: chat.title })).toBeTruthy()
  })

  it('keeps the old title when an inline rename is cancelled', async () => {
    const { link } = mount()
    fireEvent.contextMenu(link)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename chat' })
    fireEvent.change(input, { target: { value: 'Something else' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(renameChat).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: chat.title })).toBeTruthy()
  })
})
