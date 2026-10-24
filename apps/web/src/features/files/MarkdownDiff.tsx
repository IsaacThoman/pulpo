import { useMemo } from 'react'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { diffRows, lineDiff } from '@pulpo/client-core/files'

/** Line diff of two Markdown texts with a little context, or a note when they are too long to compare. */
export function MarkdownDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  const rows = useMemo(() => {
    const diff = lineDiff(before, after)
    return diff && diffRows(diff)
  }, [before, after])
  const changedLines = rows?.filter((row) => row.kind === 'added' || row.kind === 'removed').length ?? 0
  if (!rows) return <p className={cn('rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground', className)}>{ui("This file is too long to show every change.")}</p>
  return (
    <div className={cn('overflow-auto rounded-lg border bg-muted/30 font-mono text-xs leading-5', className)}>
      <p className="sticky top-0 border-b bg-muted px-3 py-1.5 font-sans text-xs text-muted-foreground">
        {changedLines === 1 ? ui("1 line changes") : uit`${changedLines} lines change`}
      </p>
      {rows.map((row, index) => row.kind === 'gap' ? (
        <div key={index} className="px-3 py-0.5 text-muted-foreground/70 select-none">{uit`⋯ ${row.count} unchanged lines`}</div>
      ) : (
        <div
          key={index}
          className={cn(
            'flex gap-2 px-3 whitespace-pre-wrap',
            row.kind === 'removed' && 'bg-red-500/10 text-red-700 dark:text-red-300',
            row.kind === 'added' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
          )}
        >
          <span aria-hidden className="w-3 shrink-0 select-none">{row.kind === 'removed' ? '−' : row.kind === 'added' ? '+' : ' '}</span>
          <span className="min-w-0 break-all">{row.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}
