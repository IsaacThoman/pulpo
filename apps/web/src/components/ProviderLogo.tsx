import { aiIconPath, getAiIcon, providerIcon } from '@/lib/ai-icons'
import { cn } from '@/lib/utils'
import type { CatalogIconReference } from '@/lib/catalog-icons'
import { runtimeResourceUrl } from '@/lib/runtime'

export function AiLogo({
  icon,
  className,
  muted = false,
  customIcon,
}: {
  icon: string
  className?: string
  muted?: boolean
  customIcon?: CatalogIconReference | null
}) {
  if (customIcon) {
    return (
      <span className={cn('relative inline-block shrink-0', muted && 'opacity-60', className)} aria-hidden>
        <img src={runtimeResourceUrl(customIcon.lightUrl)} className="size-full object-contain dark:hidden" alt="" />
        <img src={runtimeResourceUrl(customIcon.darkUrl)} className="hidden size-full object-contain dark:block" alt="" />
      </span>
    )
  }
  const definition = getAiIcon(icon)
  return (
    <img
      src={aiIconPath(icon)}
      className={cn(
        'shrink-0 object-contain',
        !definition.color && 'dark:invert',
        muted && 'opacity-60',
        className
      )}
      alt=""
      aria-hidden
    />
  )
}

export function ProviderLogo({
  provider,
  icon,
  variant = 'filled',
  className,
  customIcon,
}: {
  provider: string
  icon?: string
  variant?: 'filled' | 'outline'
  className?: string
  customIcon?: CatalogIconReference | null
}) {
  return (
    <AiLogo
      icon={icon ?? providerIcon(provider)}
      customIcon={customIcon}
      muted={variant === 'outline'}
      className={className}
    />
  )
}
