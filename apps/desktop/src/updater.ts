import type { DesktopUpdateState } from './globals'

type UpdaterEvent =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'update-downloaded'
  | 'error'

interface AutoUpdaterLike {
  on(event: UpdaterEvent, listener: (...args: unknown[]) => void): unknown
  checkForUpdates(): unknown
  quitAndInstall(): void
}

interface DesktopUpdaterOptions {
  enabled: boolean
  autoUpdater: AutoUpdaterLike
  startUpdates: () => unknown
  onStateChanged: (state: DesktopUpdateState) => void
  checkingTimeoutMs?: number
  downloadingTimeoutMs?: number
}

const DEFAULT_CHECKING_TIMEOUT_MS = 60_000
const DEFAULT_DOWNLOADING_TIMEOUT_MS = 30 * 60_000

function normalizedVersion(value: unknown): string {
  if (typeof value !== 'string') return 'new version'
  return value.trim().replace(/^v/i, '') || 'new version'
}

export class DesktopUpdater {
  private state: DesktopUpdateState = { status: 'idle' }
  private started = false
  private stateTimeout: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: DesktopUpdaterOptions) {}

  getState(): DesktopUpdateState {
    return this.state
  }

  start(): void {
    if (!this.options.enabled || this.started) return
    this.started = true
    const { autoUpdater } = this.options
    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking' }))
    autoUpdater.on('update-available', () => this.setState({ status: 'downloading' }))
    autoUpdater.on('update-not-available', () => this.setState({ status: 'idle' }))
    autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
      this.setState({ status: 'ready', version: normalizedVersion(releaseName) })
    })
    autoUpdater.on('error', () => this.setState({ status: 'error' }))
    try {
      this.observeFailure(this.options.startUpdates())
    } catch {
      this.setState({ status: 'error' })
    }
  }

  checkForUpdates(): void {
    if (!this.options.enabled || !this.started) return
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'ready') return
    this.setState({ status: 'checking' })
    try {
      this.observeFailure(this.options.autoUpdater.checkForUpdates())
    } catch {
      this.setState({ status: 'error' })
    }
  }

  restartAndInstall(): void {
    if (this.state.status !== 'ready') throw new Error('No downloaded update is ready to install.')
    this.options.autoUpdater.quitAndInstall()
  }

  private setState(state: DesktopUpdateState): void {
    if (this.state.status === 'ready' && state.status !== 'ready') return
    if (this.stateTimeout) clearTimeout(this.stateTimeout)
    this.stateTimeout = undefined
    this.state = state
    this.options.onStateChanged(state)
    const timeoutMs = state.status === 'checking'
      ? (this.options.checkingTimeoutMs ?? DEFAULT_CHECKING_TIMEOUT_MS)
      : state.status === 'downloading'
        ? (this.options.downloadingTimeoutMs ?? DEFAULT_DOWNLOADING_TIMEOUT_MS)
        : undefined
    if (timeoutMs === undefined) return
    this.stateTimeout = setTimeout(() => {
      this.stateTimeout = undefined
      if (this.state.status === state.status) this.setState({ status: 'error' })
    }, timeoutMs)
    this.stateTimeout.unref?.()
  }

  private observeFailure(result: unknown): void {
    if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return
    void Promise.resolve(result).catch(() => this.setState({ status: 'error' }))
  }
}
