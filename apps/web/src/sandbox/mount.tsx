import { Component, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

class PreviewBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <pre style={{ margin: 0, padding: 16, color: '#b91c1c', font: '13px/1.5 ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>
        {this.state.error.message}
      </pre>
    )
  }
}

export function mountComponent(App: ComponentType, container: HTMLElement, onError: (error: Error) => void): void {
  createRoot(container).render(
    <PreviewBoundary onError={onError}>
      <App />
    </PreviewBoundary>,
  )
}
