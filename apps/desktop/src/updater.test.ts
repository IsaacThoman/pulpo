import { describe, expect, it, vi } from 'vitest'
import { DesktopUpdater, type DesktopUpdateState, type ManualUpdateCheckResult } from './updater'

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
  const manualResults: ManualUpdateCheckResult[] = []
  const errors: unknown[] = []
  const startUpdates = vi.fn()
  const updater = new DesktopUpdater({
    enabled,
    autoUpdater,
    startUpdates,
    onStateChanged: (state) => states.push(state),
    onManualCheckResult: (result) => manualResults.push(result),
    onError: (error) => errors.push(error),
  })
  return { autoUpdater, errors, manualResults, states, startUpdates, updater }
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
    const { errors, startUpdates, updater } = setup()
    const error = new Error('invalid feed')
    startUpdates.mockImplementation(() => { throw error })
    expect(() => updater.start()).not.toThrow()
    expect(updater.getState()).toEqual({ status: 'error' })
    expect(errors).toEqual([error])
  })

  it('publishes update lifecycle states and caches the downloaded version', () => {
    const { autoUpdater, manualResults, states, updater } = setup()
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
    expect(manualResults).toEqual([])
  })

  it('recovers from an error on a later update check', () => {
    const { autoUpdater, manualResults, updater } = setup()
    updater.start()
    autoUpdater.emit('error', new Error('offline'))
    expect(updater.getState()).toEqual({ status: 'error' })
    updater.checkForUpdates()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.getState()).toEqual({ status: 'checking' })
    autoUpdater.emit('update-not-available')
    expect(updater.getState()).toEqual({ status: 'idle' })
    expect(manualResults).toEqual(['up-to-date'])
  })

  it('does not invent a terminal state while Electron is still checking or downloading', () => {
    const { autoUpdater, updater } = setup()
    updater.start()
    autoUpdater.emit('checking-for-update')
    expect(updater.getState()).toEqual({ status: 'checking' })
    autoUpdater.emit('update-available')
    expect(updater.getState()).toEqual({ status: 'downloading' })
  })

  it('reports synchronous and asynchronous manual check failures', async () => {
    const synchronous = setup()
    synchronous.updater.start()
    const synchronousError = new Error('offline')
    synchronous.autoUpdater.checkForUpdates.mockImplementation(() => { throw synchronousError })
    synchronous.updater.checkForUpdates()
    expect(synchronous.updater.getState()).toEqual({ status: 'error' })
    expect(synchronous.manualResults).toEqual(['error'])
    expect(synchronous.errors).toEqual([synchronousError])

    const asynchronous = setup()
    asynchronous.updater.start()
    const error = new Error('offline')
    asynchronous.autoUpdater.checkForUpdates.mockRejectedValue(error)
    asynchronous.updater.checkForUpdates()
    await vi.waitFor(() => expect(asynchronous.updater.getState()).toEqual({ status: 'error' }))
    expect(asynchronous.manualResults).toEqual(['error'])
    expect(asynchronous.errors).toEqual([error])
  })

  it('lets the standard download notification handle a successful manual update', () => {
    const { autoUpdater, manualResults, updater } = setup()
    updater.start()
    updater.checkForUpdates()
    autoUpdater.emit('update-available')
    autoUpdater.emit('update-downloaded', undefined, undefined, 'v2.0.0')
    expect(manualResults).toEqual([])
    expect(updater.getState()).toEqual({ status: 'ready', version: '2.0.0' })
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
