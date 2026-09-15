// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoTopUpSummary } from '@/lib/billing'
import { AutoTopUpSettings } from './AutoTopUpSettings'
const mocks = vi.hoisted(() => ({ api: vi.fn(), external: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: mocks.api }))
vi.mock('@/lib/runtime', () => ({ openExternalUrl: mocks.external }))
vi.mock('@/lib/query-client', () => ({ queryClient: { invalidateQueries: mocks.invalidate } }))
const initial: AutoTopUpSummary = { enabled: false, thresholdCents: 500, creditCents: 2500, monthlyLimitCents: 10000,
  revision: 0, card: null, chargedCents: 0, pendingCents: 0, resetsAt: '2026-10-01T00:00:00.000Z', processing: false, status: 'disabled' }
function show(value = initial, route = '/billing') { return render(<MemoryRouter initialEntries={[route]}><AutoTopUpSettings value={value} userId="user" /></MemoryRouter>) }
function configure() { fireEvent.click(screen.getByRole('button', { name: 'Configure top-ups' })) }
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.api.mockResolvedValue({ ...initial, revision: 1 }); mocks.invalidate.mockResolvedValue(undefined); mocks.external.mockResolvedValue(undefined) })
describe('automatic top-up settings', () => {
  it('starts disabled and requires authorization before opening card setup', async () => {
    show(); configure()
    fireEvent.click(screen.getByRole('switch', { name: 'Enable automatic top-ups' }))
    expect((screen.getByRole('button', { name: 'Save and set up card' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    mocks.api.mockResolvedValueOnce({ ...initial, revision: 1 }).mockResolvedValueOnce({ url: 'https://checkout.stripe.com/setup' })
    fireEvent.click(screen.getByRole('button', { name: 'Save and set up card' }))
    await waitFor(() => expect(mocks.external).toHaveBeenCalledWith('https://checkout.stripe.com/setup'))
    expect(mocks.api).toHaveBeenNthCalledWith(1, '/api/billing/auto-top-up', expect.objectContaining({ body: expect.objectContaining({ enabled: false, thresholdCents: 500, creditCents: 2500, monthlyLimitCents: 10000 }) }))
    expect(mocks.api).toHaveBeenNthCalledWith(2, '/api/billing/auto-top-up/setup', expect.objectContaining({ body: expect.objectContaining({ revision: 1, enable: true, consent: true }) }))
  })
  it('prevents invalid thresholds and insufficient limits', () => {
    show(); configure()
    fireEvent.change(screen.getByLabelText('When balance falls below ($)'), { target: { value: '26' } })
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('When balance falls below ($)'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Monthly spending limit ($)'), { target: { value: '25' } })
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('disables without requiring consent or card setup', async () => {
    show({ ...initial, enabled: true, status: 'active' })
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/billing/auto-top-up', expect.objectContaining({ body: expect.objectContaining({ enabled: false, revision: 0 }) })))
    expect(mocks.external).not.toHaveBeenCalled()
  })
  it('requires explicit resume after payment failure', async () => {
    show({ ...initial, enabled: true, status: 'payment_issue', card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 } }); configure()
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/billing/auto-top-up', expect.objectContaining({ body: expect.objectContaining({ enabled: true, resume: true, consent: true }) })))
  })
  it('shows a server error and keeps the form available', async () => {
    show(); configure(); mocks.api.mockRejectedValueOnce(new Error('Settings changed'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Settings changed'))
  })
  it('confirms setup on return and refreshes billing', async () => {
    await act(async () => { show(initial, '/billing?auto_top_up=setup') })
    expect(mocks.api).toHaveBeenCalledWith('/api/billing/auto-top-up/setup/confirm', { method: 'POST' })
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['billing', 'user'] })
  })
})
