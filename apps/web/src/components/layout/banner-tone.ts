import type { BannerType } from '@pulpo/contracts'

export function bannerToneClassName(type: BannerType): string {
  if (type === 'error') return 'bg-destructive text-destructive-foreground'
  if (type === 'warning') return 'bg-amber-500 text-black'
  return 'bg-primary text-primary-foreground'
}
