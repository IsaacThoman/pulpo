interface ComposerKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  isComposing: boolean
}

export function shouldSubmitComposerKey(event: ComposerKeyEvent): boolean {
  return event.key === 'Enter'
    && (event.metaKey || event.ctrlKey)
    && !event.isComposing
}
