interface ComposerKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  isComposing: boolean
}

export function shouldSubmitComposerKey(event: ComposerKeyEvent, sendWithEnter: boolean): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false
  return sendWithEnter || event.metaKey || event.ctrlKey
}
