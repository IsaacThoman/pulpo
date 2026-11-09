import { DEFAULT_USAGE_VISIBILITY, usageVisibilitySchema, type UsageVisibility } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

export const USAGE_VISIBILITY_VALUES = usageVisibilitySchema.options

/** Profiles cached before the setting existed lack it; the server default applies to them. */
export function resolvedUsageVisibility(value: UsageVisibility | null | undefined): UsageVisibility {
  return value ?? DEFAULT_USAGE_VISIBILITY
}

/** The Settings choice. Pool members always see usage, so the narrowest level is Pool-only. */
export function usageVisibilityLabel(value: UsageVisibility): string {
  switch (value) {
    case 'pool': return ui("Private (Pool only)")
    case 'friends': return ui("Friends")
    case 'public': return ui("Public")
  }
}

/** Who can see the signed-in user's usage, for their own profile. */
export function usageVisibilitySummary(value: UsageVisibility): string {
  switch (value) {
    case 'pool': return ui("Usage visible to your Pool")
    case 'friends': return ui("Usage visible to friends")
    case 'public': return ui("Usage visible to everyone")
  }
}

/** Who can see the signed-in user's usage, spelled out for the profile's visibility tooltip. */
export function usageVisibilityDetail(value: UsageVisibility): string {
  switch (value) {
    case 'pool': return ui("Only members of your Pool can see your usage stats and requests.")
    case 'friends': return ui("Your friends and Pool members can see your usage stats and requests.")
    case 'public': return ui("Anyone signed in can see your usage stats and requests.")
  }
}
