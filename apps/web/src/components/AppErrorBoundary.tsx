import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'
import { isChunkLoadError, isReloadingForStaleBuild, reloadForStaleBuild } from '@/lib/stale-build'

type Props = { children: ReactNode }
type State = { error: unknown; reloading: boolean }

/** Last-resort boundary: recovers from stale-build chunk errors and otherwise offers a reload. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false }

  static getDerivedStateFromError(error: unknown): State {
    // Once a stale-build reload has started, a cancelled preload resolves to undefined and the
    // lazy component then fails on a missing export. Keep the loading screen until the reload.
    if (isReloadingForStaleBuild()) return { error, reloading: true }
    return { error, reloading: false }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (this.state.reloading) return
    if (isChunkLoadError(error) && reloadForStaleBuild()) {
      this.setState({ reloading: true })
      return
    }
    console.error('Unhandled render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.state.reloading) {
      return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">{ui("Loading Pulpo…")}</div>
    }
    const updated = isChunkLoadError(this.state.error)
    return (
      <div role="alert" className="grid min-h-dvh place-items-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <h1 className="text-base font-medium">{updated ? ui("Pulpo was updated") : ui("Something went wrong")}</h1>
          <p className="text-sm text-muted-foreground">
            {updated ? ui("Reload to get the latest version.") : ui("Reload the page to try again.")}
          </p>
          <Button onClick={() => window.location.reload()}>{ui("Reload")}</Button>
        </div>
      </div>
    )
  }
}
