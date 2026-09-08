// A background Shortcuts launch must not hydrate the foreground session while
// its SecureStore token is locked: that would be mistaken for sign-out and
// revoke the native automation session. Bootstrap once the UI becomes active.
export function runWhenAppActive(
  appState: {
    readonly currentState: string | null
    addEventListener(event: 'change', listener: (state: string) => void): { remove(): void }
  },
  run: () => void,
): () => void {
  let started = false
  const onChange = (state: string | null) => {
    if (state !== 'active' || started) return
    started = true
    run()
  }
  const subscription = appState.addEventListener('change', onChange)
  onChange(appState.currentState)
  return () => subscription.remove()
}
