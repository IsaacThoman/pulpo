import type { DataRetentionTag } from '@pulpo/contracts'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PresetIcon } from './PresetIcon'

type BadgeTag = Pick<DataRetentionTag, 'name' | 'description' | 'icon' | 'color'>

/** The tag's icon drawn in its color. */
export function DataRetentionBadgeMark({ tag, className }: { tag: BadgeTag; className?: string }) {
  return (
    <span className="inline-flex shrink-0" style={{ color: tag.color }}>
      <PresetIcon name={tag.icon} className={cn('size-4', className)} />
    </span>
  )
}

export function DataRetentionBadge({ tag, className }: { tag: BadgeTag; className?: string }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tag.description ? `${tag.name}. ${tag.description}` : tag.name}
          className={cn('inline-flex cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50', className)}
        >
          <DataRetentionBadgeMark tag={tag} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 text-left text-pretty">
        <p className="font-medium">{tag.name}</p>
        {tag.description && <p className="mt-0.5 opacity-80">{tag.description}</p>}
      </TooltipContent>
    </Tooltip>
  )
}
