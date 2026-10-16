import { useEffect, useState } from 'react'
import type { Banner } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'
import { BannerCard } from './BannerCard'
import { dismissBanner, pruneDismissedBannerIds, readDismissedBannerIds } from './banner-dismissals'

/**
 * Floats active admin banners over the top of the main column, just below page headers.
 * z-25 keeps them above the chat header (z-20) and under the mobile drawer backdrop (z-30).
 */
export function BannerBar() {
  const [banners, setBanners] = useState<Banner[]>([])
  const instanceReady = useAuth((state) => state.instanceReady)
  const networkReady = !isDesktopRuntime() || instanceReady
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
  if (banners.length === 0) return null
  return (
    <div className="site-banners pointer-events-none absolute inset-x-0 top-14 z-[25] flex flex-col items-center gap-2 px-3">
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
