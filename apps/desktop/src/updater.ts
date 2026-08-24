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
}

function normalizedVersion(value: unknown): string {
  if (typeof value !== 'string') return 'new version'
  return value.trim().replace(/^v/i, '') || 'new version'
}

export class DesktopUpdater {
  private state: DesktopUpdateState = { status: 'idle' }
  private started = false

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
      this.options.startUpdates()
    } catch {
      this.setState({ status: 'error' })
    }
  }

  checkForUpdates(): void {
    if (!this.options.enabled || !this.started) return
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'ready') return
    this.options.autoUpdater.checkForUpdates()
  }

  restartAndInstall(): void {
    if (this.state.status !== 'ready') throw new Error('No downloaded update is ready to install.')
    this.options.autoUpdater.quitAndInstall()
  }

  private setState(state: DesktopUpdateState): void {
    if (this.state.status === 'ready' && state.status !== 'ready') return
    this.state = state
    this.options.onStateChanged(state)
  }
}
