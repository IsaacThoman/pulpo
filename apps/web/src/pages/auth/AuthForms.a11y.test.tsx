// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { authState } = vi.hoisted(() => ({
  authState: {
    user: null,
    login: vi.fn(),
    signup: vi.fn(),
    setup: vi.fn(),
    passkeyLogin: vi.fn(),
    signupEnabled: true,
    setupRequired: false as boolean | null,
    instanceUrl: 'https://pulpo.baby',
    chooseInstance: vi.fn(),
    signedInAccounts: [],
    refreshSignedInAccounts: vi.fn(async () => undefined),
    switchAccount: vi.fn(),
  },
}))

vi.mock('@/stores/auth', () => ({
  useAuth: Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    { getState: () => authState },
  ),
}))
vi.mock('@/lib/passkeys', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  browserSupportsWebAuthnAutofill: vi.fn(async () => false),
  cancelPasskeyCeremony: vi.fn(),
}))

const { LoginPage } = await import('./LoginPage')
const { SignupPage } = await import('./SignupPage')
const { SetupPage } = await import('./SetupPage')

afterEach(() => { cleanup(); vi.clearAllMocks(); authState.setupRequired = false })

const mount = (page: React.ReactNode) => render(<MemoryRouter>{page}</MemoryRouter>)

function describedText(element: HTMLElement) {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent)
}

describe('auth form accessibility', () => {
  it('announces a failed sign-in and marks both credentials invalid', async () => {
    authState.login.mockResolvedValue({ ok: false, error: 'Invalid email or password' })
    mount(<LoginPage />)
    const email = screen.getByLabelText('Email')
    const password = screen.getByLabelText('Password')
    expect(email.hasAttribute('aria-invalid')).toBe(false)
    expect(email.hasAttribute('aria-describedby')).toBe(false)

    fireEvent.change(email, { target: { value: 'ada@example.com' } })
    fireEvent.change(password, { target: { value: 'wrong' } })
    await act(async () => { fireEvent.submit(email.closest('form')!) })

    expect(screen.getByRole('alert').textContent).toBe('Invalid email or password')
    for (const field of [email, password]) {
      expect(field.getAttribute('aria-invalid')).toBe('true')
      expect(describedText(field)).toEqual(['Invalid email or password'])
    }
  })

  it('keeps the password visibility toggle in the tab order and exposes its state', () => {
    mount(<LoginPage />)
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle.hasAttribute('tabindex')).toBe(false)
    expect(toggle.getAttribute('aria-controls')).toBe('password')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Show password' })).toBe(toggle)
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text')
  })

  it('ties a sign-up password mismatch to the password fields only', async () => {
    mount(<SignupPage />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password-999' } })
    await act(async () => { fireEvent.submit(screen.getByLabelText('Password').closest('form')!) })

    const alert = screen.getByRole('alert')
    expect(screen.getByLabelText('Confirm password').getAttribute('aria-invalid')).toBe('true')
    expect(describedText(screen.getByLabelText('Confirm password'))).toEqual([alert.textContent])
    expect(screen.getByLabelText('Display name').hasAttribute('aria-invalid')).toBe(false)
    expect(screen.getByLabelText('Display name').hasAttribute('aria-describedby')).toBe(false)
    expect(authState.signup).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Show password' }).hasAttribute('tabindex')).toBe(false)
  })

  it('describes every setup field with a server error without claiming which one is wrong', async () => {
    authState.setupRequired = true
    authState.setup.mockResolvedValue({ ok: false, error: 'Username is already taken' })
    mount(<SetupPage />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password-123' } })
    await act(async () => { fireEvent.submit(screen.getByLabelText('Password').closest('form')!) })

    expect(screen.getByRole('alert').textContent).toBe('Username is already taken')
    const username = screen.getByLabelText('Username')
    const description = describedText(username)
    expect(description).toHaveLength(2)
    expect(description[1]).toBe('Username is already taken')
    expect(username.hasAttribute('aria-invalid')).toBe(false)
  })
})
