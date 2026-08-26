export type DesktopUpdateState =
  | { status: 'idle' | 'checking' | 'downloading' | 'error' }
  | { status: 'ready'; version: string }

export type ManualUpdateCheckResult = 'up-to-date' | 'error'

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
  onManualCheckResult: (result: ManualUpdateCheckResult) => void
  onError: (error: unknown) => void
}

function normalizedVersion(value: unknown): string {
  if (typeof value !== 'string') return 'new version'
  return value.trim().replace(/^v/i, '') || 'new version'
}

export class DesktopUpdater {
  private state: DesktopUpdateState = { status: 'idle' }
  private started = false
  private manualCheckPending = false

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
    autoUpdater.on('update-not-available', () => {
      this.setState({ status: 'idle' })
      this.finishManualCheck('up-to-date')
    })
    autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
      this.setState({ status: 'ready', version: normalizedVersion(releaseName) })
      this.manualCheckPending = false
    })
    autoUpdater.on('error', (error) => this.handleError(error))
    try {
      this.observeFailure(this.options.startUpdates())
    } catch (error) {
      this.handleError(error)
    }
  }

  checkForUpdates(): void {
    if (!this.options.enabled || !this.started) return
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'ready') return
    this.manualCheckPending = true
    this.setState({ status: 'checking' })
    try {
      this.observeFailure(this.options.autoUpdater.checkForUpdates())
    } catch (error) {
      this.handleError(error)
    }
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

  private observeFailure(result: unknown): void {
    if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return
    void Promise.resolve(result).catch((error) => this.handleError(error))
  }

  private handleError(error: unknown): void {
    this.options.onError(error)
    this.setState({ status: 'error' })
    this.finishManualCheck('error')
  }

  private finishManualCheck(result: ManualUpdateCheckResult): void {
    if (!this.manualCheckPending) return
    this.manualCheckPending = false
    this.options.onManualCheckResult(result)
  }
}
