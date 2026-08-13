import type { SidebarPins } from '@pulpo/contracts'

export type SidebarPinKey = keyof SidebarPins

export function toggleSidebarPin(pins: SidebarPins, key: SidebarPinKey): SidebarPins {
  return { ...pins, [key]: !pins[key] }
}
