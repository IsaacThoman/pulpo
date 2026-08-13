type FrameScheduler = (listener: () => void) => number
type FrameCanceller = (frame: number) => void

type ComposerAutoFocusDependencies = {
  cancelFrame: FrameCanceller
  focus: () => void
  scheduleFrame: FrameScheduler
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
