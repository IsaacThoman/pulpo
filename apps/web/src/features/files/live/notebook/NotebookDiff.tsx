import { useMemo } from 'react'
import { diffNotebookFiles, type NotebookCellChange, type NotebookCellSummary, type NotebookDiff as Diff } from '@pulpo/client-core/office/notebook'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { FileVersionsSummary } from '../FileVersionsSummary'
import type { LiveDiffProps } from '../types'

function typeLabel(type: NotebookCellSummary['type']): string {
  return type === 'code' ? ui("Code") : type === 'markdown' ? ui("Markdown") : ui("Raw")
}

function kindLabel(change: NotebookCellChange): string {
  switch (change.kind) {
    case 'added': return ui("Added")
    case 'removed': return ui("Removed")
    case 'moved': return change.outputsChanged ? ui("Moved, outputs changed") : ui("Moved")
    case 'changed':
      if (change.sourceChanged || change.typeChanged) return change.moved ? ui("Moved and edited") : ui("Edited")
      return ui("Outputs changed")
    default: return ''
  }
}

function summaryLine(diff: Diff): string {
  const parts = [
    diff.counts.added && (diff.counts.added === 1 ? ui("1 cell added") : uit`${diff.counts.added} cells added`),
    diff.counts.removed && (diff.counts.removed === 1 ? ui("1 cell removed") : uit`${diff.counts.removed} cells removed`),
    diff.counts.changed && (diff.counts.changed === 1 ? ui("1 cell edited") : uit`${diff.counts.changed} cells edited`),
    diff.counts.moved && (diff.counts.moved === 1 ? ui("1 cell moved") : uit`${diff.counts.moved} cells moved`),
    diff.counts.outputs && (diff.counts.outputs === 1 ? ui("1 cell with new outputs") : uit`${diff.counts.outputs} cells with new outputs`),
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : ui("The two versions are the same.")
}

function Lines({ text, tone }: { text: string; tone: 'added' | 'removed' | 'same' }) {
  const lines = text.replace(/\n$/, '').split('\n')
  return (
    <>
      {lines.map((line, index) => (
        <div key={index} className={cn('flex gap-2 px-3 whitespace-pre-wrap', tone === 'removed' && 'bg-red-500/10 text-red-700 dark:text-red-300', tone === 'added' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300')}>
          <span aria-hidden className="w-3 shrink-0 select-none">{tone === 'removed' ? '−' : tone === 'added' ? '+' : ' '}</span>
          <span className="min-w-0 break-all">{line || ' '}</span>
        </div>
      ))}
    </>
  )
}

function Outputs({ before, after }: { before: NotebookCellSummary | null; after: NotebookCellSummary | null }) {
  const describe = (cell: NotebookCellSummary | null) => cell?.outputs.map((output) => (output.text ? `${output.kind}: ${output.text}` : output.kind)) ?? []
  const left = describe(before)
  const right = describe(after)
  if (!left.length && !right.length) return null
  const count = (cell: NotebookCellSummary | null) => (cell?.executionCount === null || cell?.executionCount === undefined ? '' : ` [${cell.executionCount}]`)
  return (
    <div className="border-t px-3 py-1.5 font-sans text-[11px] text-muted-foreground" data-diff-outputs>
      {before && after && JSON.stringify(left) !== JSON.stringify(right) ? (
        <>
          <p>{uit`Outputs before${count(before)}: ${left.length ? left.join('; ') : ui("none")}`}</p>
          <p>{uit`Outputs after${count(after)}: ${right.length ? right.join('; ') : ui("none")}`}</p>
        </>
      ) : (
        <p>{uit`Outputs${count(after ?? before)}: ${(right.length ? right : left).join('; ')}`}</p>
      )}
    </div>
  )
}

function ChangedCell({ change, index }: { change: Exclude<NotebookCellChange, { kind: 'unchanged' }>; index: number }) {
  const summary = change.kind === 'removed' ? change.before : change.after
  const tone = change.kind === 'added' ? 'border-emerald-500/40' : change.kind === 'removed' ? 'border-red-500/40' : 'border-amber-500/40'
  return (
    <section className={cn('overflow-hidden rounded-lg border-l-4 border bg-background', tone)} data-diff-cell={change.kind}>
      <header className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1 font-sans text-xs">
        <span className="font-medium text-foreground">{kindLabel(change)}</span>
        <span className="text-muted-foreground">
          {uit`Cell ${index + 1}`} · {change.kind === 'changed' && change.typeChanged ? `${typeLabel(change.before.type)} → ${typeLabel(change.after.type)}` : typeLabel(summary.type)}
        </span>
      </header>
      <div className="font-mono text-xs leading-5">
        {change.kind === 'added' && <Lines text={change.after.source} tone="added" />}
        {change.kind === 'removed' && <Lines text={change.before.source} tone="removed" />}
        {(change.kind === 'changed' || change.kind === 'moved') && (change.source ? change.source.map((row, rowIndex) => (
          row.kind === 'gap'
            ? <div key={rowIndex} className="px-3 py-0.5 font-sans text-muted-foreground/70 select-none">{uit`⋯ ${row.count} unchanged lines`}</div>
            : <Lines key={rowIndex} text={row.text} tone={row.kind} />
        )) : <Lines text={change.after.source} tone="same" />)}
      </div>
      <Outputs before={change.kind === 'added' ? null : change.before} after={change.kind === 'removed' ? null : change.after} />
    </section>
  )
}

/**
 * An agent's change to a notebook, cell by cell: cells added, removed, moved, and edited (with a
 * line diff of the source), and how outputs changed. Unchanged cells fold away.
 */
export function NotebookDiff({ name, before, after, className }: LiveDiffProps) {
  const diff = useMemo(() => {
    try {
      return diffNotebookFiles(before, after)
    } catch {
      return null
    }
  }, [before, after])
  if (!diff) return <FileVersionsSummary name={name} before={before} after={after} className={className} />
  const rows: ({ kind: 'same'; count: number } | { kind: 'cell'; change: Exclude<NotebookCellChange, { kind: 'unchanged' }>; index: number })[] = []
  let position = 0
  for (const change of diff.cells) {
    if (change.kind === 'unchanged') {
      const last = rows[rows.length - 1]
      if (last?.kind === 'same') last.count += 1
      else rows.push({ kind: 'same', count: 1 })
      position += 1
      continue
    }
    rows.push({ kind: 'cell', change, index: change.kind === 'removed' ? position : position })
    if (change.kind !== 'removed') position += 1
  }
  return (
    <div className={cn('flex flex-col gap-2 overflow-auto rounded-lg border bg-muted/30 p-2', className)} data-notebook-diff>
      <p className="px-1 text-xs text-muted-foreground">{summaryLine(diff)}</p>
      {diff.metadata.length > 0 && <p className="px-1 text-xs text-muted-foreground">{uit`Notebook settings changed: ${diff.metadata.join(', ')}`}</p>}
      {rows.map((row, index) => row.kind === 'same' ? (
        <div key={index} className="px-1 text-xs text-muted-foreground/70 select-none">{row.count === 1 ? ui("⋯ 1 unchanged cell") : uit`⋯ ${row.count} unchanged cells`}</div>
      ) : <ChangedCell key={index} change={row.change} index={row.index} />)}
    </div>
  )
}

export default NotebookDiff
