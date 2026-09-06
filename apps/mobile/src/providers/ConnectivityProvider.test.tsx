// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkState } from 'expo-network'

const native = vi.hoisted(() => ({
  getState: vi.fn<() => Promise<NetworkState>>(),
  networkListener: undefined as ((state: NetworkState) => void) | undefined,
  appListener: undefined as ((state: string) => void) | undefined,
  removeNetwork: vi.fn(),
  removeApp: vi.fn(),
}))
vi.mock('expo-network', () => ({
  getNetworkStateAsync: native.getState,
  addNetworkStateListener: (listener: typeof native.networkListener) => {
    native.networkListener = listener
    return { remove: native.removeNetwork }
  },
}))
vi.mock('react-native', () => ({
  AppState: { addEventListener: (_event: string, listener: typeof native.appListener) => {
    native.appListener = listener
    return { remove: native.removeApp }
  } },
}))

import { ConnectivityProvider } from './ConnectivityProvider'
import { useNetworkOffline } from './useNetworkOffline'
import { useRealtimeStore } from './realtimeStore'
import { shouldShowConnectionBanner } from './realtimeConnection'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
const available = { isConnected: true, isInternetReachable: true }
const unvalidated = { isConnected: true, isInternetReachable: false }
function Status() {
  const offline = useNetworkOffline()
  const { connectionPhase: phase, syncError } = useRealtimeStore()
  return <span>{offline ? 'Offline' : 'Online'}{shouldShowConnectionBanner({ phase, offline, syncError }) ? ' · Banner' : ''}</span>
}
async function mount() {
  await act(async () => root.render(<ConnectivityProvider><Status /></ConnectivityProvider>))
}
beforeEach(() => {
  vi.clearAllMocks()
  native.getState.mockResolvedValue(available)
  useRealtimeStore.setState({ connected: false, connectionPhase: 'connecting', syncError: null })
  onlineManager.setOnline(true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  onlineManager.setOnline(true)
})

describe('mobile connectivity', () => {
  it('clears false Android offline state when Pulpo connects and keeps query scheduling online', async () => {
    native.getState.mockResolvedValue(unvalidated)
    await mount()
    expect(container.textContent).toBe('Offline · Banner')
    expect(onlineManager.isOnline()).toBe(false)
    await act(async () => useRealtimeStore.getState().setConnectionPhase('connected'))
    expect(container.textContent).toBe('Online')
    expect(onlineManager.isOnline()).toBe(true)
    // Later stale native events cannot override the working Pulpo transport.
    await act(async () => native.networkListener?.({ isConnected: false, isInternetReachable: false }))
    expect(container.textContent).toBe('Online')
    expect(onlineManager.isOnline()).toBe(true)
    await act(async () => useRealtimeStore.getState().setConnectionPhase('reconnecting'))
    expect(container.textContent).toBe('Offline · Banner')
    expect(onlineManager.isOnline()).toBe(false)
  })

  it('keeps reconnection and actionable sync errors visible on an available network', async () => {
    await mount()
    await act(async () => useRealtimeStore.getState().setConnectionPhase('reconnecting'))
    expect(container.textContent).toBe('Online · Banner')
    await act(async () => {
      useRealtimeStore.getState().setConnectionPhase('connected')
      useRealtimeStore.getState().setSyncError('A queued change was rejected')
    })
    expect(container.textContent).toBe('Online · Banner')
    expect(onlineManager.isOnline()).toBe(true)
  })

  it('refreshes stale offline state on foreground without needing a native event', async () => {
    native.getState.mockResolvedValueOnce(unvalidated).mockResolvedValue(available)
    await mount()
    expect(container.textContent).toBe('Offline · Banner')
    await act(async () => native.appListener?.('active'))
    expect(container.textContent).toBe('Online')
    expect(onlineManager.isOnline()).toBe(true)
  })

  it('does not let an older async lookup overwrite a newer network event', async () => {
    let resolve!: (state: NetworkState) => void
    native.getState.mockReturnValue(new Promise((done) => { resolve = done }))
    await mount()
    await act(async () => native.networkListener?.(available))
    await act(async () => resolve(unvalidated))
    expect(container.textContent).toBe('Online')
    expect(onlineManager.isOnline()).toBe(true)
  })

  it('does not classify unknown state or a failed native lookup as offline', async () => {
    native.getState.mockRejectedValue(new Error('Network state unavailable'))
    await mount()
    expect(container.textContent).toBe('Online')
    expect(onlineManager.isOnline()).toBe(true)
  })

  it('removes listeners and ignores a lookup that finishes after unmount', async () => {
    let resolve!: (state: NetworkState) => void
    native.getState.mockReturnValue(new Promise((done) => { resolve = done }))
    await mount()
    await act(async () => root.render(null))
    expect(native.removeNetwork).toHaveBeenCalledOnce()
    expect(native.removeApp).toHaveBeenCalledOnce()
    await act(async () => resolve(unvalidated))
    expect(onlineManager.isOnline()).toBe(true)
  })
})
