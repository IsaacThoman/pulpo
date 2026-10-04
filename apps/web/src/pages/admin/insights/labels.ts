import type { ClientPlatform } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

export const PLATFORMS: ClientPlatform[] = ['web', 'desktop', 'ios', 'android', 'cli', 'api', 'unknown']
export const PLANS = ['baby', 'eight', 'fat', 'unknown'] as const
export const ORIGINS = ['web', 'api', 'admin_chat'] as const

export function platformLabel(platform: string): string {
  switch (platform) {
    case 'web': return ui('Web')
    case 'desktop': return ui('Desktop')
    case 'ios': return ui('iOS')
    case 'android': return ui('Android')
    case 'cli': return ui('CLI')
    case 'api': return ui('API')
    case 'unknown': return ui('Unknown')
    default: return platform
  }
}

export function planLabel(plan: string): string {
  switch (plan) {
    case 'baby': return ui('Baby')
    case 'eight': return ui('Eight')
    case 'fat': return ui('Fat')
    case 'unknown': return ui('Unknown')
    default: return plan
  }
}

export function originLabel(origin: string): string {
  switch (origin) {
    case 'web': return ui('Web')
    case 'api': return ui('API')
    case 'admin_chat': return ui('Admin chat')
    case 'unknown': return ui('Unknown')
    default: return origin
  }
}

export function branchReasonLabel(reason: string): string {
  switch (reason) {
    case 'message': return ui('New message')
    case 'regenerate': return ui('Regenerate')
    case 'user_edit': return ui('Edit')
    default: return reason
  }
}

/** Setting values; `unknown` means the request left the model default in place. */
export function settingLabel(id: string, label: string): string {
  return id === 'unknown' ? ui('Model default') : label
}
