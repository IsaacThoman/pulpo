type FrameScheduler = (listener: () => void) => number
type FrameCanceller = (frame: number) => void

type ComposerAutoFocusDependencies = {
  cancelFrame: FrameCanceller
  focus: () => void
  scheduleFrame: FrameScheduler
}

export type ComposerFocusAction = 'blur' | 'focus'

type ComposerFocusRequestDependencies = ComposerAutoFocusDependencies & {
  blur: () => void
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

/** Apply an explicit focus request after navigation changes the active chat. */
export function startComposerFocusRequest(
  action: ComposerFocusAction,
  dependencies: ComposerFocusRequestDependencies,
): () => void {
  if (action === 'focus') return startComposerAutoFocus(dependencies)

  let active = true
  let settleFrame: number | null = null
  dependencies.blur()
  const navigationFrame = dependencies.scheduleFrame(() => {
    if (!active) return
    dependencies.blur()
    settleFrame = dependencies.scheduleFrame(() => {
      if (active) dependencies.blur()
    })
  })

  return () => {
    active = false
    dependencies.cancelFrame(navigationFrame)
    if (settleFrame !== null) dependencies.cancelFrame(settleFrame)
  }
}
