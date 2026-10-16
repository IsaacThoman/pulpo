import { bannerWindowIsValid, type Banner, type BannerCreateInput, type BannerType } from '@pulpo/contracts'
import { isoFromLocalInput, localInputValue } from '@/lib/datetime-local'

export type BannerStatus = 'active' | 'scheduled' | 'expired'

/** Mirrors the window `GET /api/banners` uses to decide what users see. */
export function bannerStatus(banner: Pick<Banner, 'startsAt' | 'endsAt'>, now = Date.now()): BannerStatus {
  if (banner.endsAt && Date.parse(banner.endsAt) <= now) return 'expired'
  if (banner.startsAt && Date.parse(banner.startsAt) >= now) return 'scheduled'
  return 'active'
}

/** Form state; schedule fields hold `datetime-local` values in the admin's zone. */
export interface BannerDraft {
  type: BannerType
  content: string
  dismissible: boolean
  startsAt: string
  endsAt: string
}

export const EMPTY_BANNER_DRAFT: BannerDraft = { type: 'info', content: '', dismissible: true, startsAt: '', endsAt: '' }

export function draftFromBanner(banner: Banner): BannerDraft {
  return {
    type: banner.type,
    content: banner.content,
    dismissible: banner.dismissible,
    startsAt: localInputValue(banner.startsAt),
    endsAt: localInputValue(banner.endsAt),
  }
}

export function bannerInputFromDraft(draft: BannerDraft): Required<BannerCreateInput> {
  return {
    type: draft.type,
    content: draft.content.trim(),
    dismissible: draft.dismissible,
    startsAt: isoFromLocalInput(draft.startsAt),
    endsAt: isoFromLocalInput(draft.endsAt),
  }
}

export type BannerDraftError = 'content-required' | 'content-too-long' | 'invalid-window'

/** The first problem that blocks saving, or null when the draft is valid. */
export function bannerDraftError(draft: BannerDraft): BannerDraftError | null {
  const content = draft.content.trim()
  if (!content) return 'content-required'
  if (content.length > 2_000) return 'content-too-long'
  const input = bannerInputFromDraft(draft)
  if (!bannerWindowIsValid(input.startsAt, input.endsAt)) return 'invalid-window'
  return null
}
