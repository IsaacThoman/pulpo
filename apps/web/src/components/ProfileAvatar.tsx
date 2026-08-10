import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { profileInitials } from '@/lib/profile'

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
  return (
    <Avatar className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={`${name}'s profile picture`} className="object-cover" />}
      <AvatarFallback className={cn('bg-zinc-700 font-semibold text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900', fallbackClassName)}>
        {profileInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
