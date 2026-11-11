import { Star } from 'lucide-react'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { useGithubStars } from '@/lib/github-stars'
import { cn } from '@/lib/utils'

/** The repo's star count for a GitHub link. Renders nothing until the count arrives, so the link looks as before when GitHub can't be reached. */
export function GithubStars({ className }: { className?: string }) {
  const stars = useGithubStars()
  if (stars === null) return null
  const formatted = new Intl.NumberFormat(activeLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(stars)
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums animate-in fade-in-0 duration-300', className)}>
      <Star aria-hidden="true" className="size-3.5" />
      <span aria-hidden="true">{formatted}</span>
      <span className="sr-only">{stars === 1 ? ui("1 star") : uit`${formatted} stars`}</span>
    </span>
  )
}
