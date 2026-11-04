import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const isDark = () => document.documentElement.classList.contains('dark')

/** Whether the app is showing its dark theme (the `dark` class `applyTheme` sets on the root). */
export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false)
}
