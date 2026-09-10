import { useRef, useState } from 'react'

// Browsers can treat Radix's restored focus as focus-visible after a pointer
// selection. Preserve focus for navigation, but only show its ring for keyboard use.
export function useMenuTriggerFocus() {
  const keyboard = useRef(false)
  const [pointerFocus, setPointerFocus] = useState(false)
  const onPointerDownCapture = () => {
    keyboard.current = false
    setPointerFocus(true)
  }
  const onKeyDownCapture = () => {
    keyboard.current = true
    setPointerFocus(false)
  }

  return {
    triggerProps: {
      'data-pointer-focus': pointerFocus || undefined,
      onPointerDownCapture,
      onKeyDownCapture,
      onBlur: () => setPointerFocus(false),
    },
    contentProps: {
      onPointerDownCapture,
      onPointerDownOutside: onPointerDownCapture,
      onKeyDownCapture,
      onCloseAutoFocus: () => setPointerFocus(!keyboard.current),
    },
  }
}
