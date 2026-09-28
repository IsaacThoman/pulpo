import { sidebarPinsSchema, type SidebarPins } from '@pulpo/contracts'

export type SidebarPinKey = keyof SidebarPins

export const DEFAULT_SIDEBAR_PINS: SidebarPins = sidebarPinsSchema.parse({})

/** Fills keys added after a preference was saved with their defaults. */
export function normalizeSidebarPins(value: unknown): SidebarPins {
  return sidebarPinsSchema.catch(DEFAULT_SIDEBAR_PINS).parse(value ?? {})
}

export function toggleSidebarPin(pins: SidebarPins, key: SidebarPinKey): SidebarPins {
  return { ...pins, [key]: !pins[key] }
}
