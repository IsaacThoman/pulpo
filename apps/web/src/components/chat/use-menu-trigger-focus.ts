import { useRef, useState } from 'react'

// Browsers can treat Radix's restored focus as focus-visible after a pointer
// selection. Preserve focus for navigation, but only show its ring for keyboard use.
export function useMenuTriggerFocus(onSelectClose?: () => void) {
  const keyboard = useRef(false)
  const selected = useRef(false)
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
    onSelect: () => { selected.current = true },
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
      onCloseAutoFocus: (event: Event) => {
        const focusSelectionTarget = selected.current && onSelectClose
        selected.current = false
        if (focusSelectionTarget) {
          event.preventDefault()
          setPointerFocus(false)
          // Wait for the menu's focus scope to close before returning to typing.
          focusSelectionTarget()
        } else {
          setPointerFocus(!keyboard.current)
        }
      },
    },
  }
}
