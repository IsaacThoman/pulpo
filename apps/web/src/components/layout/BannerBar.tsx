import { useEffect, useState } from 'react'
import type { Banner } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'
import { BannerCard } from './BannerCard'
import { dismissBanner, pruneDismissedBannerIds, readDismissedBannerIds } from './banner-dismissals'
import { SignupPromoBanner } from './SignupPromoBanner'
import { useSignupPromoOffer } from './signup-promo'

/**
 * Floats active admin banners, and any signup promo, over the top of the main column, just below page headers.
 * z-25 keeps them above the chat header (z-20) and under the mobile drawer backdrop (z-30).
 */
export function BannerBar({ signupPromo = true }: { signupPromo?: boolean }) {
  const [banners, setBanners] = useState<Banner[]>([])
  const instanceReady = useAuth((state) => state.instanceReady)
  const networkReady = !isDesktopRuntime() || instanceReady
  const promo = useSignupPromoOffer(signupPromo)
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
  // Stays mounted while empty so the promo can confirm a claim after its offer goes away.
  return (
    <div className="site-banners pointer-events-none absolute inset-x-0 top-14 z-[25] flex flex-col items-center gap-2 px-3">
      {signupPromo && <SignupPromoBanner offer={promo.data} className="site-banner-enter pointer-events-auto max-w-2xl" />}
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
