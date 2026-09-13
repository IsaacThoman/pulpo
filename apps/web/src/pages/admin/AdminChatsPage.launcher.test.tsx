// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { AdminChatsPage } from './AdminChatsPage'

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), request: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  apiRequest: mocks.request,
}))
vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text }))

const chatId = '9db9ea5a-3af7-4b66-9f2a-c179278a0998'
const shareId = 'cb77ae97-bb22-4ad8-aed7-ef691df9babc'
const input = () => screen.getByRole('textbox') as HTMLInputElement
const submit = () => fireEvent.submit(input().closest('form')!)
const enter = (value: string) => fireEvent.change(input(), { target: { value } })

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

describe('admin chat launcher', () => {
  it.each([chatId, `/c/${chatId}`, `/admin/chats/${chatId}`])('opens %s without a share lookup', (value) => {
    render(<AdminChatsPage />)
    enter(value)
    submit()
    expect(mocks.navigate).toHaveBeenCalledWith(`/admin/chats/${chatId}`)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('resolves through the instance API and opens the original chat, not the share ID', async () => {
    mocks.request.mockResolvedValue({ id: shareId, chat: { id: chatId } })
    render(<AdminChatsPage />)
    enter('https://another.pulpo.example/share/abc_DEF-123/?source=test#latest')
    submit()
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(`/admin/chats/${chatId}`))
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('/api/shares/abc_DEF-123', { signal: expect.any(AbortSignal) })
  })

  it('disables the form while resolving and ignores repeated submissions', async () => {
    let resolve!: (value: unknown) => void
    mocks.request.mockImplementation(() => new Promise((done) => { resolve = done }))
    render(<AdminChatsPage />)
    enter('/share/token')
    submit()
    expect(input().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(input().closest('form')!.getAttribute('aria-busy')).toBe('true')
    submit()
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).not.toHaveBeenCalled()
    resolve({ chat: { id: chatId } })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(`/admin/chats/${chatId}`))
  })

  it.each([
    [new ApiError(404, 'share_not_found', 'This share does not exist or has expired'), 'This shared link is unavailable, expired, or revoked.'],
    [new TypeError('Failed to fetch'), 'Unable to resolve this shared chat. Please try again.'],
  ])('shows lookup failures and allows retry', async (error, message) => {
    mocks.request.mockRejectedValueOnce(error).mockResolvedValueOnce({ chat: { id: chatId } })
    render(<AdminChatsPage />)
    enter('/share/token')
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(input().disabled).toBe(false)
    expect(mocks.navigate).not.toHaveBeenCalled()
    submit()
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(`/admin/chats/${chatId}`))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed input locally and clears the error on edit', () => {
    render(<AdminChatsPage />)
    enter('/share/token/extra')
    submit()
    expect(screen.getByRole('alert').textContent).toContain('Enter a valid chat UUID')
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    enter('/share/token')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('aborts pending resolution when leaving the launcher', async () => {
    let resolve!: (value: unknown) => void
    mocks.request.mockImplementation(() => new Promise((done) => { resolve = done }))
    const { unmount } = render(<AdminChatsPage />)
    enter('/share/token')
    submit()
    const { signal } = mocks.request.mock.calls[0]![1] as { signal: AbortSignal }
    unmount()
    expect(signal.aborted).toBe(true)
    resolve({ chat: { id: chatId } })
    await Promise.resolve()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
