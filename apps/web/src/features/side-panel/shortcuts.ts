export const isApplePlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** A Cmd/Ctrl shortcut label for this platform, e.g. `⌘J` or `Ctrl+J`. */
export function panelShortcut(key: string): string {
  return `${isApplePlatform ? '⌘' : 'Ctrl+'}${key}`
}
