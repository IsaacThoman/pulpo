import { useEffect, useState } from 'react'
import { SIGNUP_PROMO_CLAIM_MS, type Banner } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'
import { BannerCard } from './BannerCard'
import { SignupPromoBanner } from './SignupPromoBanner'
import { dismissBanner, pruneDismissedBannerIds, readDismissedBannerIds } from './banner-dismissals'

/**
 * Floats active admin banners over the top of the main column, just below page headers.
 * z-25 keeps them above the chat header (z-20) and under the mobile drawer backdrop (z-30).
 */
export function BannerBar() {
  const [banners, setBanners] = useState<Banner[]>([])
  const instanceReady = useAuth((state) => state.instanceReady)
  const billingEnabled = useAuth((state) => state.billingEnabled)
  const user = useAuth((state) => state.user)
  const networkReady = !isDesktopRuntime() || instanceReady
  const promoExpiresAt = user ? Date.parse(user.createdAt) + SIGNUP_PROMO_CLAIM_MS : 0
  const promoUserId = networkReady && billingEnabled && user && user.role !== 'pending'
    && promoExpiresAt > Date.now() ? user.id : undefined
  useEffect(() => {
    if (!networkReady) return
    void apiRequest<{ data: Banner[] }>('/api/banners').then((result) => {
      pruneDismissedBannerIds(result.data.map((banner) => banner.id))
      const dismissed = readDismissedBannerIds()
      setBanners(result.data.filter((banner) => !banner.dismissible || !dismissed.has(banner.id)))
    }).catch(() => undefined)
  }, [networkReady])
  const dismiss = (id: string) => {
    dismissBanner(id)
    setBanners((items) => items.filter((item) => item.id !== id))
  }
  if (banners.length === 0 && !promoUserId) return null
  return (
    <div className="site-banners pointer-events-none absolute inset-x-0 top-14 z-[25] flex flex-col items-center gap-2 px-3">
      {promoUserId && <SignupPromoBanner key={promoUserId} userId={promoUserId} expiresAt={promoExpiresAt} />}
      {banners.map((banner) => (
        <BannerCard
          key={banner.id}
          type={banner.type}
          content={banner.content}
          onDismiss={banner.dismissible ? () => dismiss(banner.id) : undefined}
          className="site-banner-enter pointer-events-auto max-w-2xl"
        />
      ))}
    </div>
  )
}
