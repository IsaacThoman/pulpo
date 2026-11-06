import { ArrowRight } from 'lucide-react'
import { ui, uit } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { cn } from '@/lib/utils'
import type { LiveDiffProps } from './types'

/** For formats without a diff of their own yet: what changed in size, and that it changed at all. */
export function FileVersionsSummary({ name, before, after, className }: LiveDiffProps) {
  const same = before.byteLength === after.byteLength && before.every((byte, index) => byte === after[index])
  return (
    <div className={cn('rounded-lg border bg-muted/30 p-4 text-sm', className)}>
      <p className="font-medium">{name}</p>
      <p className="mt-1 flex items-center gap-1.5 text-muted-foreground tabular-nums">
        {formatBytes(before.byteLength)} <ArrowRight className="size-3.5" /> {formatBytes(after.byteLength)}
      </p>
      <p className="mt-2 text-muted-foreground">
        {same ? ui("The two versions are the same.") : uit`A detailed comparison of ${name} isn't available yet. Download both versions to compare them.`}
      </p>
    </div>
  )
}
