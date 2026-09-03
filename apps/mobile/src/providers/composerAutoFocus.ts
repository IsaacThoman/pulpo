type FrameScheduler = (listener: () => void) => number
type FrameCanceller = (frame: number) => void

type ComposerAutoFocusDependencies = {
  cancelFrame: FrameCanceller
  focus: () => void
  scheduleFrame: FrameScheduler
}

type ComposerFocusTransitionDependencies = ComposerAutoFocusDependencies & {
  blur: () => void
  dismissKeyboard: () => void
  target: 'composer' | 'content'
}

/**
 * Focus after two native frames so the keyboard provider and chat keyboard
 * handlers are attached before iOS begins presenting the keyboard.
 */
export function startComposerAutoFocus({
  cancelFrame,
  focus,
  scheduleFrame,
}: ComposerAutoFocusDependencies): () => void {
  let active = true
  let focusFrame: number | null = null
  const mountFrame = scheduleFrame(() => {
    if (!active) return
    focusFrame = scheduleFrame(() => {
      if (active) focus()
    })
  })

  return () => {
    active = false
    cancelFrame(mountFrame)
    if (focusFrame !== null) cancelFrame(focusFrame)
  }
}

/**
 * Apply the focus intent that accompanied a chat navigation. Existing chats
 * leave the transcript active without a keyboard, while a new chat waits for
 * the drawer transition before focusing the composer.
 */
export function startComposerFocusTransition({
  blur,
  cancelFrame,
  dismissKeyboard,
  focus,
  scheduleFrame,
  target,
}: ComposerFocusTransitionDependencies): () => void {
  if (target === 'content') {
    blur()
    dismissKeyboard()
    return () => undefined
  }

  return startComposerAutoFocus({ cancelFrame, focus, scheduleFrame })
}
