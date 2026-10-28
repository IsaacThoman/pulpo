// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined }),
  })
})
const apiRequest = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ id: 'report-1' })))
vi.mock('@/lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiRequest }))

const { ReportMessageButton } = await import('./ReportMessageButton')
const { useAuth } = await import('@/stores/auth')
const { useFileToasts } = await import('@/features/files/browser/toasts')
const { clearAdminChatGrant, setAdminChatGrant } = await import('@/features/admin-chat/access')
const { ApiError } = await import('@/lib/api')

const messageId = '0196f7e2-7b1c-7000-8000-000000000001'

beforeEach(() => {
  apiRequest.mockClear()
  useAuth.setState({ messageReportsEnabled: true })
  useFileToasts.setState({ toasts: [] })
})
afterEach(() => {
  cleanup()
  clearAdminChatGrant()
})

describe('ReportMessageButton', () => {
  it('is hidden unless the instance enables reports', () => {
    useAuth.setState({ messageReportsEnabled: false })
    render(<ReportMessageButton messageId={messageId} />)
    expect(screen.queryByRole('button', { name: 'Report message' })).toBeNull()
  })

  it('is hidden while an admin views someone else\'s chat', () => {
    setAdminChatGrant({
      accessToken: 'token', accessId: 'access', expiresAt: new Date(Date.now() + 60_000).toISOString(), chatId: 'chat',
      owner: { id: 'owner', email: 'owner@example.test', name: 'Owner', username: 'owner', role: 'user', blocked: false },
    })
    render(<ReportMessageButton messageId={messageId} />)
    expect(screen.queryByRole('button', { name: 'Report message' })).toBeNull()
  })

  it('shares the message with its context and confirms in a toast', async () => {
    render(<ReportMessageButton messageId={messageId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Report message' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  It made up a citation.  ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share with admin' })) })

    expect(apiRequest).toHaveBeenCalledWith('/api/message-reports', {
      method: 'POST', body: { messageId, context: 'It made up a citation.' },
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(useFileToasts.getState().toasts.map((toast) => toast.message)).toEqual(['Report sent. An admin will review this chat.'])
  })

  it('sends nothing when canceled', () => {
    render(<ReportMessageButton messageId={messageId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Report message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(apiRequest).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the dialog and the context open when sending fails', async () => {
    apiRequest.mockRejectedValueOnce(new ApiError(403, 'message_reports_disabled', 'Message reports are disabled'))
    render(<ReportMessageButton messageId={messageId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Report message' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Still here' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share with admin' })) })

    expect(screen.getByRole('alert').textContent).toBe('Message reports are disabled')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Still here')
    expect(useFileToasts.getState().toasts).toEqual([])
  })
})
