// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiRequest } from '@/lib/api'
import { DictationSection } from './sections-dictation'
import { DatabaseSection } from './sections-data'

vi.mock('@/lib/api', () => ({ apiRequest: vi.fn(), downloadApiFile: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuth: { setState: vi.fn() } }))
vi.mock('./RestoreBackupForm', () => ({ RestoreBackupForm: () => null }))

const dictation = { enabled: true, hasApiKey: true, billUsers: false, pricePerMinuteMicros: 10_000 }
const backups = {
  enabled: false, applicationKeyConfigured: true, endpoint: 'https://s3.us-west-004.backblazeb2.com',
  bucket: 'backups', prefix: 'pulpo', keyId: 'key-id', recipient: 'age1recipient',
  intervalHours: 24, retentionDays: 30, health: 'disabled',
}

beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockImplementation(async (path) => {
    if (path === '/api/me/two-factor') return { enabled: true }
    if (path.endsWith('/reveal')) return { apiKey: 'saved-secret' }
    if (path === '/api/admin/settings/dictation') return dictation
    if (path === '/api/admin/settings/backups') return backups
    return { data: [] }
  })
})
afterEach(cleanup)

describe.each([
  { name: 'Groq API key', Component: DictationSection, path: '/api/admin/settings/dictation', reveal: 'api-key', method: 'PATCH', field: 'groqApiKey' },
  { name: 'Application key', Component: DatabaseSection, path: '/api/admin/settings/backups', reveal: 'application-key', method: 'PUT', field: 'applicationKey' },
])('$name reveal', ({ name, Component, path, reveal, method, field }) => {
  const revealPath = `${path}/${reveal}/reveal`
  const openReveal = async () => {
    fireEvent.click(await screen.findByRole('button', { name: `Show ${name}` }))
    return screen.findByLabelText('Authenticator or recovery code')
  }
  const confirmReveal = async () => {
    fireEvent.change(await openReveal(), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }
  const secretInput = () => {
    const toggle = screen.queryByRole('button', { name: `Hide ${name}` }) ?? screen.getByRole('button', { name: `Show ${name}` })
    return toggle.parentElement!.querySelector('input')!
  }

  it('challenges for 2FA, reveals the saved key, clears it on hide, and challenges again', async () => {
    render(<Component />)
    await openReveal()
    expect(apiRequest).not.toHaveBeenCalledWith(revealPath, expect.anything())
    fireEvent.change(screen.getByLabelText('Authenticator or recovery code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(apiRequest).toHaveBeenCalledWith(revealPath, { method: 'POST', body: { verificationCode: '123456', currentPassword: undefined } })
    expect(secretInput().value).toBe('saved-secret')
    expect(secretInput().type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: `Hide ${name}` }))
    expect(secretInput().value).toBe('')
    expect(secretInput().type).toBe('password')
    await openReveal()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('uses the current password when 2FA is disabled', async () => {
    render(<Component />)
    await screen.findByRole('button', { name: `Show ${name}` })
    vi.mocked(apiRequest).mockResolvedValueOnce({ enabled: false })
    fireEvent.click(screen.getByRole('button', { name: `Show ${name}` }))
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(apiRequest).toHaveBeenCalledWith(revealPath, { method: 'POST', body: { currentPassword: 'password', verificationCode: undefined } })
    expect(secretInput().value).toBe('saved-secret')
  })

  it('keeps the key hidden on authentication failure', async () => {
    render(<Component />)
    fireEvent.change(await openReveal(), { target: { value: '654321' } })
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Invalid verification code'))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid verification code')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(secretInput().value).toBe('')
    expect(secretInput().type).toBe('password')
  })

  it('ignores a reveal response after the challenge is cancelled', async () => {
    render(<Component />)
    fireEvent.change(await openReveal(), { target: { value: '123456' } })
    let resolve!: (value: { apiKey: string }) => void
    vi.mocked(apiRequest).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => resolve({ apiKey: 'saved-secret' }))
    expect(secretInput().value).toBe('')
    expect(secretInput().type).toBe('password')
  })

  it('omits revealed keys from saves and connection tests, then clears the display on save', async () => {
    render(<Component />)
    await confirmReveal()
    if (field === 'applicationKey') {
      fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
      await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`${path}/test`, { method: 'POST', body: expect.not.objectContaining({ applicationKey: expect.anything() }) }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(path, { method, body: expect.not.objectContaining({ [field]: expect.anything() }) }))
    await waitFor(() => expect(secretInput().value).toBe(''))
    expect(secretInput().type).toBe('password')
  })

  it('allows toggling replacement text without a challenge and saves the replacement', async () => {
    render(<Component />)
    await screen.findByRole('button', { name: `Show ${name}` })
    fireEvent.change(secretInput(), { target: { value: 'replacement-secret' } })
    fireEvent.click(screen.getByRole('button', { name: `Show ${name}` }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(secretInput().value).toBe('replacement-secret')
    expect(secretInput().type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: `Hide ${name}` }))
    expect(secretInput().value).toBe('replacement-secret')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(path, { method, body: expect.objectContaining({ [field]: 'replacement-secret' }) }))
    await waitFor(() => expect(secretInput().value).toBe(''))
  })
})
