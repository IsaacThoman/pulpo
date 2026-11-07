// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SettingsSectionId } from './settings-dialog'

const mocks = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined), request: vi.fn() }))
vi.mock('@/lib/instance-features', () => ({ refreshInstanceFeatures: mocks.refresh }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), apiRequest: mocks.request }))
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
const { useAuth } = await import('@/stores/auth')
const { useSettings } = await import('@/stores/settings')
const { SettingsModal } = await import('./SettingsModal')
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const user = {
  id: 'user-1', email: 'ada@example.com', name: 'Ada Tester', username: 'ada', avatarUrl: null,
  profileColor: '#ef4444', role: 'user', initials: 'AT',
} as unknown as NonNullable<ReturnType<typeof useAuth.getState>['user']>

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.setState({ codexEnabled: false, billingEnabled: false, user })
  useSettings.setState({ theme: 'dark' })
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/memory-document') return { content: '', revision: 1, lastEditor: 'user', editSummary: '', sourceResponseId: null, updatedAt: null }
    if (path === '/api/memory-document/revisions') return { data: [] }
    if (path === '/api/settings') return { values: {}, instructionPresets: [{ id: 'casual', title: 'Casual', color: '#3b82f6', instructions: 'Be casual.', defaultEnabled: false }] }
    if (path === '/api/attachments/usage') return { usedBytes: 0, limitBytes: 1024, remainingBytes: 1024 }
    if (path === '/api/trash') return { items: [], files: true }
    return { data: [] }
  })
})
afterEach(() => { cleanup(); client.clear() })

function open(section: SettingsSectionId) {
  return render(<QueryClientProvider client={client}><MemoryRouter><SettingsModal open onClose={() => {}} initialSection={section} /></MemoryRouter></QueryClientProvider>)
}

describe('settings dialog accessibility', () => {
  it('names the dialog by its visible title and marks the current section', () => {
    open('general')
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog.hasAttribute('aria-describedby')).toBe(false)
    const nav = within(dialog).getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('button', { name: 'Interface' }).hasAttribute('aria-current')).toBe(false)
    fireEvent.click(within(nav).getByRole('button', { name: 'Interface' }))
    expect(within(nav).getByRole('button', { name: 'Interface' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('button', { name: 'General' }).hasAttribute('aria-current')).toBe(false)
  })

  it('exposes the theme choice and names the language select by its label', () => {
    open('general')
    const theme = screen.getByRole('group', { name: 'Theme' })
    expect(within(theme).getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(theme).getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(theme).getByRole('button', { name: 'Light' }))
    expect(within(theme).getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy()
  })

  it('names every interface control and links its hint', () => {
    open('interface')
    for (const name of ['Send with Enter', 'Sync composer drafts', 'Open search with double Shift', 'Show prompt suggestions', 'Show model warnings', 'Show reasoning', 'Show response costs']) {
      expect(screen.getByRole('switch', { name })).toBeTruthy()
    }
    for (const name of ['Chat width', 'Chat order', 'Double-click a file']) expect(screen.getByRole('combobox', { name })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: 'Chats kept on this device' })).toBeTruthy()
    const cache = screen.getByRole('spinbutton', { name: 'Downloaded attachment cache' })
    expect(cache.getAttribute('aria-describedby')?.split(' ').map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Maximum file data retained after you upload or explicitly download a file.',
      'MB',
    ])
    const sendWithEnter = screen.getByRole('switch', { name: 'Send with Enter' })
    expect(document.getElementById(sendWithEnter.getAttribute('aria-describedby')!)?.textContent).toContain('Shift+Enter')
  })

  it('labels profile fields, names colors, and announces save errors', async () => {
    mocks.request.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/me' && init?.method === 'PATCH') throw new Error('Display name is taken')
      return {}
    })
    open('profile')
    const name = screen.getByRole('textbox', { name: 'Display name' })
    const colors = screen.getByRole('group', { name: 'Friends chart color' })
    expect(within(colors).getByRole('button', { name: 'Red' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(colors).getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(colors).queryByRole('button', { name: /#/ })).toBeNull()
    fireEvent.change(name, { target: { value: 'Ada L' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save profile' })) })
    expect(screen.getByRole('alert').textContent).toBe('Display name is taken')
  })

  it('labels personalization fields and exposes the MEMORY.md view toggle', async () => {
    open('personalization')
    expect(screen.getByRole('textbox', { name: 'Custom instructions' }).getAttribute('placeholder')).toContain('Be terse')
    expect(screen.getByRole('switch', { name: 'Memories' })).toBeTruthy()
    expect(await screen.findByRole('group', { name: 'Instruction presets' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Casual' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('heading', { level: 3, name: 'MEMORY.md' })).toBeTruthy()
    const view = screen.getByRole('group', { name: 'MEMORY.md' })
    expect(within(view).getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed')).toBe('true')
    await screen.findByText('MEMORY.md is empty.')
    fireEvent.click(within(view).getByRole('button', { name: 'Write' }))
    expect(within(view).getByRole('button', { name: 'Write' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('textbox', { name: 'MEMORY.md' })).toBeTruthy()
  })

  it('names the data and trash selects', () => {
    open('data')
    expect(screen.getByRole('combobox', { name: 'Automatic chat expiration' })).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'File storage' })).toBeTruthy()
    cleanup()
    open('trash')
    expect(screen.getByRole('combobox', { name: 'Trash retention period' })).toBeTruthy()
  })
})
