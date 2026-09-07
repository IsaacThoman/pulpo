import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn(), logout: vi.fn(), user: { id: 'owner' } }))
vi.mock('./api', () => ({ apiRequest: mocks.request, ApiError: class extends Error { status: number; constructor(status: number) { super('API failure'); this.status = status } } }))
vi.mock('@/stores/auth', () => ({ useAuth: { getState: () => ({ user: mocks.user, logout: mocks.logout }) } }))
import { ApiError } from './api'
import { handleSessionConnectionError } from './session-revocation'
beforeEach(() => vi.resetAllMocks())
describe('remote session sign-out', () => {
  it('confirms an unauthorized socket against HTTP and clears credentials', async () => {
    mocks.request.mockRejectedValue(new ApiError(401, 'unauthorized', 'Expired'))
    await handleSessionConnectionError(new Error('unauthorized'))
    expect(mocks.request).toHaveBeenCalledWith('/api/me')
    expect(mocks.logout).toHaveBeenCalledWith(true)
  })
  it('keeps credentials on transport, server, and network failures or a valid session', async () => {
    await handleSessionConnectionError(new Error('websocket error'))
    expect(mocks.request).not.toHaveBeenCalled()
    mocks.request.mockRejectedValueOnce(new TypeError('Network down'))
    await handleSessionConnectionError(new Error('unauthorized'))
    mocks.request.mockResolvedValueOnce({ user: mocks.user })
    await handleSessionConnectionError(new Error('unauthorized'))
    expect(mocks.logout).not.toHaveBeenCalled()
  })
})
