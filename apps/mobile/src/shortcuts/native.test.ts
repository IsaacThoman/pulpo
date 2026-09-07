import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ setSession: vi.fn(), getEnabled: vi.fn(() => true), setEnabled: vi.fn(), getScope: vi.fn(() => 'scope'), takePendingNavigation: vi.fn<() => string[]>(() => []), addListener: vi.fn(() => ({ remove: vi.fn() })) }))
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mocks }))
import { clearShortcutsSession, syncShortcutsSession, listenForNativeShortcutLinks } from './native.ios'
beforeEach(() => vi.clearAllMocks())
it('synchronizes only authenticated, unblocked accounts', () => {
  const state = { status: 'authenticated', instanceUrl: 'https://pulpo.test', token: 'token', user: { id: 'user' } }
  syncShortcutsSession(state)
  expect(mocks.setSession).toHaveBeenLastCalledWith('https://pulpo.test', 'user', 'token')
  for (const patch of [{ status: 'anonymous' }, { status: 'pending' }, { token: null }, { user: { id: 'user', blocked: true } }]) {
    syncShortcutsSession({ ...state, ...patch })
    expect(mocks.setSession).toHaveBeenLastCalledWith(null, null, null)
  }
})
it('does not erase the background session during startup hydration', () => {
  syncShortcutsSession({ status: 'hydrating', instanceUrl: '', token: null, user: null })
  expect(mocks.setSession).not.toHaveBeenCalled()
})
it('clears credentials synchronously before sign-out continues', () => {
  clearShortcutsSession()
  expect(mocks.setSession).toHaveBeenCalledWith(null, null, null)
})
it('keeps the main app usable when the native sync fails closed', () => {
  mocks.setSession.mockImplementationOnce(() => { throw new Error('Keychain locked') })
  expect(() => syncShortcutsSession({ status: 'anonymous', instanceUrl: '', token: null, user: null })).not.toThrow()
})
it('continues main-app sign-out when native deletion fails closed', () => {
  mocks.setSession.mockImplementationOnce(() => { throw new Error('Keychain locked') })
  expect(clearShortcutsSession).not.toThrow()
})

it('subscribes before draining requests delivered before JavaScript startup', () => {
  const receive = vi.fn()
  const remove = vi.fn()
  mocks.addListener.mockImplementationOnce(() => {
    expect(mocks.takePendingNavigation).not.toHaveBeenCalled()
    return { remove }
  })
  mocks.takePendingNavigation.mockReturnValueOnce(['pulpo://shortcuts?early'])
  const stop = listenForNativeShortcutLinks(receive)
  expect(receive).toHaveBeenCalledWith('pulpo://shortcuts?early')
  stop()
  expect(remove).toHaveBeenCalledOnce()
})
it('drains foreground requests arriving after JavaScript startup', () => {
  const receive = vi.fn()
  const stop = listenForNativeShortcutLinks(receive)
  mocks.takePendingNavigation.mockReturnValueOnce(['pulpo://shortcuts?warm'])
  const listener = (mocks.addListener.mock.calls[0] as unknown as [string, () => void])[1]
  listener()
  expect(receive).toHaveBeenCalledWith('pulpo://shortcuts?warm')
  stop()
})
