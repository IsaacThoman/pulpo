import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { profileInitials } from '@/lib/profile'
import { useRuntimeImageUrl } from '@/lib/runtime-resource'
import { uit } from '@/i18n/ui'

export function ProfileAvatar({
  name,
  avatarUrl,
  className,
  fallbackClassName,
}: {
  name: string
  avatarUrl?: string | null
  className?: string
  fallbackClassName?: string
}) {
  const image = useRuntimeImageUrl(avatarUrl, { authenticated: true })
  return (
    <Avatar className={cn(className, 'rounded-none')}>
      {image.url && <AvatarImage src={image.url} alt={uit`${name}'s profile picture`} className="object-contain" />}
      <AvatarFallback className={cn('bg-zinc-700 font-semibold text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900', fallbackClassName)}>
        {profileInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
