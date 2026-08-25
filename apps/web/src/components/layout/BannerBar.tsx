import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'

interface Banner { id: string; type: string; content: string; dismissible: boolean }

export function BannerBar() {
  const [banners, setBanners] = useState<Banner[]>([])
  const instanceReady = useAuth((state) => state.instanceReady)
  const networkReady = !isDesktopRuntime() || instanceReady
  useEffect(() => {
    if (!networkReady) return
    void apiRequest<{ data: Banner[] }>('/api/banners').then((result) => setBanners(result.data)).catch(() => undefined)
  }, [networkReady])
  return <div className="absolute inset-x-0 top-0 z-30 space-y-px">{banners.map((banner) => <div key={banner.id} className={cn('flex min-h-9 items-center justify-center gap-3 px-4 py-2 text-center text-xs', banner.type === 'error' ? 'bg-destructive text-destructive-foreground' : banner.type === 'warning' ? 'bg-amber-500 text-black' : 'bg-primary text-primary-foreground')}>
    <span>{banner.content}</span>{banner.dismissible && <button aria-label="Dismiss banner" onClick={() => setBanners((items) => items.filter((item) => item.id !== banner.id))}><X className="size-3.5" /></button>}
  </div>)}</div>
}
