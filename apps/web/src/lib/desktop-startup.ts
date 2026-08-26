interface DesktopStartupState {
  desktop: boolean
  hasCachedUser: boolean
  checkingSession: boolean
  instanceReady: boolean
}

export function desktopStartupSurface(state: DesktopStartupState): 'app' | 'connecting' | 'instance' {
  if (!state.desktop || state.hasCachedUser || state.instanceReady) return 'app'
  return state.checkingSession ? 'connecting' : 'instance'
}
