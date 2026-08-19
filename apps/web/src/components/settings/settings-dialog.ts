import { createContext, createElement, useContext, type ReactNode } from 'react'

export const SETTINGS_SECTION_IDS = [
  'general',
  'profile',
  'security',
  'personalization',
  'interface',
  'billing',
  'api',
  'data',
  'trash',
  'about',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

interface SettingsDialogController {
  openSettings: (section?: SettingsSectionId) => void
}

const SettingsDialogContext = createContext<SettingsDialogController | null>(null)

export function SettingsDialogProvider({
  controller,
  children,
}: {
  controller: SettingsDialogController
  children: ReactNode
}) {
  return createElement(SettingsDialogContext.Provider, { value: controller }, children)
}

export function useSettingsDialog(): SettingsDialogController {
  const controller = useContext(SettingsDialogContext)
  if (!controller) throw new Error('useSettingsDialog must be used within SettingsDialogProvider')
  return controller
}
