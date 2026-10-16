import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Banner } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'
import { ui } from '@/i18n/ui'
import { bannerToneClassName } from './banner-tone'
import { dismissBanner, pruneDismissedBannerIds, readDismissedBannerIds } from './banner-dismissals'

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
  return <div className="absolute inset-x-0 top-0 z-30 space-y-px">{banners.map((banner) => <div key={banner.id} className={cn('flex min-h-9 items-center justify-center gap-3 px-4 py-2 text-center text-xs', bannerToneClassName(banner.type))}>
    <span>{banner.content}</span>{banner.dismissible && <button aria-label={ui("Dismiss banner")} onClick={() => dismiss(banner.id)}><X className="size-3.5" /></button>}
  </div>)}</div>
}
