import { aiIconPath, getAiIcon, providerIcon } from '@/lib/ai-icons'
import { cn } from '@/lib/utils'

export function AiLogo({
  icon,
  className,
  muted = false,
}: {
  icon: string
  className?: string
  muted?: boolean
}) {
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
}: {
  provider: string
  icon?: string
  variant?: 'filled' | 'outline'
  className?: string
}) {
  return (
    <AiLogo
      icon={icon ?? providerIcon(provider)}
      muted={variant === 'outline'}
      className={className}
    />
  )
}
