import { describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState } from './globals'
import { DesktopUpdater } from './updater'

class FakeAutoUpdater {
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  readonly checkForUpdates = vi.fn()
  readonly quitAndInstall = vi.fn()

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

function setup(enabled = true) {
  const autoUpdater = new FakeAutoUpdater()
  const states: DesktopUpdateState[] = []
  const startUpdates = vi.fn()
  const updater = new DesktopUpdater({
    enabled,
    autoUpdater,
    startUpdates,
    onStateChanged: (state) => states.push(state),
    checkingTimeoutMs: 100,
    downloadingTimeoutMs: 200,
  })
  return { autoUpdater, states, startUpdates, updater }
}

describe('DesktopUpdater', () => {
  it('does not initialize for an unsupported or unpackaged app', () => {
    const { autoUpdater, startUpdates, updater } = setup(false)
    updater.start()
    updater.checkForUpdates()
    expect(startUpdates).not.toHaveBeenCalled()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.getState()).toEqual({ status: 'idle' })
  })

  it('initializes the scheduled updater only once', () => {
    const { startUpdates, updater } = setup()
    updater.start()
    updater.start()
    expect(startUpdates).toHaveBeenCalledTimes(1)
  })

  it('reports a bootstrap error without crashing app startup', () => {
    const { startUpdates, updater } = setup()
    startUpdates.mockImplementation(() => { throw new Error('invalid feed') })
    expect(() => updater.start()).not.toThrow()
    expect(updater.getState()).toEqual({ status: 'error' })
  })

  it('publishes update lifecycle states and caches the downloaded version', () => {
    const { autoUpdater, states, updater } = setup()
    updater.start()
    autoUpdater.emit('checking-for-update')
    autoUpdater.emit('update-available')
    autoUpdater.emit('update-downloaded', undefined, undefined, 'v1.4.0')
    expect(states).toEqual([
      { status: 'checking' },
      { status: 'downloading' },
      { status: 'ready', version: '1.4.0' },
    ])
    expect(updater.getState()).toEqual({ status: 'ready', version: '1.4.0' })
    autoUpdater.emit('checking-for-update')
    autoUpdater.emit('error', new Error('offline'))
    expect(updater.getState()).toEqual({ status: 'ready', version: '1.4.0' })
  })

  it('recovers from an error on a later update check', () => {
    const { autoUpdater, updater } = setup()
    updater.start()
    autoUpdater.emit('error', new Error('offline'))
    expect(updater.getState()).toEqual({ status: 'error' })
    updater.checkForUpdates()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.getState()).toEqual({ status: 'checking' })
    autoUpdater.emit('update-not-available')
    expect(updater.getState()).toEqual({ status: 'idle' })
  })

  it('recovers when an update check never emits a terminal event', () => {
    vi.useFakeTimers()
    const { autoUpdater, updater } = setup()
    updater.start()
    autoUpdater.emit('checking-for-update')

    vi.advanceTimersByTime(99)
    expect(updater.getState()).toEqual({ status: 'checking' })
    vi.advanceTimersByTime(1)
    expect(updater.getState()).toEqual({ status: 'error' })
    vi.useRealTimers()
  })

  it('recovers when an update download stalls', () => {
    vi.useFakeTimers()
    const { autoUpdater, updater } = setup()
    updater.start()
    autoUpdater.emit('update-available')

    vi.advanceTimersByTime(199)
    expect(updater.getState()).toEqual({ status: 'downloading' })
    vi.advanceTimersByTime(1)
    expect(updater.getState()).toEqual({ status: 'error' })
    vi.useRealTimers()
  })

  it('reports synchronous and asynchronous manual check failures', async () => {
    const synchronous = setup()
    synchronous.updater.start()
    synchronous.autoUpdater.checkForUpdates.mockImplementation(() => { throw new Error('offline') })
    synchronous.updater.checkForUpdates()
    expect(synchronous.updater.getState()).toEqual({ status: 'error' })

    const asynchronous = setup()
    asynchronous.updater.start()
    asynchronous.autoUpdater.checkForUpdates.mockRejectedValue(new Error('offline'))
    asynchronous.updater.checkForUpdates()
    await vi.waitFor(() => expect(asynchronous.updater.getState()).toEqual({ status: 'error' }))
  })

  it('does not start duplicate checks while one is active or an update is ready', () => {
    const { autoUpdater, updater } = setup()
    updater.start()
    updater.checkForUpdates()
    autoUpdater.emit('checking-for-update')
    updater.checkForUpdates()
    autoUpdater.emit('update-available')
    updater.checkForUpdates()
    autoUpdater.emit('update-downloaded', undefined, undefined, '2.0.0')
    updater.checkForUpdates()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('refuses to restart before download completion and installs once ready', () => {
    const { autoUpdater, updater } = setup()
    updater.start()
    expect(() => updater.restartAndInstall()).toThrow('No downloaded update is ready')
    autoUpdater.emit('update-downloaded', undefined, undefined, 'v2.1.0')
    updater.restartAndInstall()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})
