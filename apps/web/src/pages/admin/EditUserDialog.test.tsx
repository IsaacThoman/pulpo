// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorUser } from '@/lib/types'
import { EditUserDialog } from './EditUserDialog'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.request }))
vi.mock('@/lib/runtime', () => ({ runtimeAccountKey: (id: string) => id }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text, activeLocale: () => 'en-US' }))

const user: MonitorUser = {
  id: 'target', name: 'Test User', username: 'test_user', email: 'test@example.test',
  role: 'user', balance: 0, joinedAt: 0, blocked: false, avatarUrl: null, profileColor: null,
  defaultModelId: 'model-a', inviteCodeQuota: 10,
}
let client: QueryClient
const save = vi.fn()
const close = vi.fn()
function mount(target = user) {
  return render(<QueryClientProvider client={client}>
    <EditUserDialog key={target.id} user={target} billingEnabled onSave={save} onClose={close} />
  </QueryClientProvider>)
}
const selector = () => screen.getByRole('combobox', { name: 'Default model' }) as HTMLButtonElement
async function choose(label: string) {
  await waitFor(() => expect(selector().disabled).toBe(false))
  fireEvent.keyDown(selector(), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  mocks.request.mockResolvedValue({ data: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }] })
  save.mockResolvedValue(undefined)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(() => { cleanup(); client.clear() })

describe('Edit user default model', () => {
  it('loads the target user’s models and preserves an unchanged default', async () => {
    mount()
    await waitFor(() => expect(selector().textContent).toBe('Model A (model-a)'))
    expect(mocks.request).toHaveBeenCalledWith('/api/admin/users/target/models', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith('target', { name: user.name, username: user.username, email: user.email, inviteCodeQuota: 10 })
  })

  it.each([
    ['Model B (model-b)', 'model-b'],
    ['Automatic (first available)', null],
  ])('saves %s alongside other edits', async (label, defaultModelId) => {
    mount()
    await choose(label!)
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('target', expect.objectContaining({ defaultModelId, name: 'Updated' })))
  })

  it('preserves an unavailable default and allows replacing it', async () => {
    mount({ ...user, defaultModelId: 'retired' })
    await waitFor(() => expect(selector().disabled).toBe(false))
    expect(selector().textContent).toBe('Unavailable (retired)')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0][1]).not.toHaveProperty('defaultModelId')
    await choose('Model B (model-b)')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('target', expect.objectContaining({ defaultModelId: 'model-b' })))
  })

  it('uses Automatic for a missing preference, including an empty catalog', async () => {
    mocks.request.mockResolvedValue({ data: [] })
    mount({ ...user, defaultModelId: null })
    await waitFor(() => expect(selector().disabled).toBe(false))
    expect(selector().textContent).toBe('Automatic (first available)')
  })

  it('loads fresh state when switching users', async () => {
    const first = mount()
    await choose('Model B (model-b)')
    first.unmount()
    mount({ ...user, id: 'second', defaultModelId: null })
    await waitFor(() => expect(selector().disabled).toBe(false))
    expect(selector().textContent).toBe('Automatic (first available)')
    expect(mocks.request).toHaveBeenLastCalledWith('/api/admin/users/second/models', expect.anything())
  })

  it('offers retry after a loading failure without losing form edits', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Offline'))
    mount()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Still here' } })
    await screen.findByText('Could not load models.')
    expect(selector().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(selector().disabled).toBe(false))
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Still here')
  })

  it('allows other edits while loading without clearing the saved default', async () => {
    mocks.request.mockImplementation(() => new Promise(() => {}))
    mount()
    expect(selector().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Loading models…')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0][1]).not.toHaveProperty('defaultModelId')
  })

  it('blocks duplicate saves and retains the draft after a save error', async () => {
    let rejectSave!: (error: Error) => void
    save.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject }))
    mount()
    await choose('Model B (model-b)')
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Keep me' } })
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    await act(async () => rejectSave(new Error('Model no longer available')))
    expect(screen.getByRole('alert').textContent).toBe('Model no longer available')
    expect(selector().textContent).toBe('Model B (model-b)')
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Keep me')
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
  })
})
