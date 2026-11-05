import { useState } from 'react'
import type { DiffBlock, DiffBlockSummary, DiffSegment, DocxDiff, FormatChange } from '@pulpo/client-core/office/docx'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'

/**
 * A redline of two versions of a Word document (from `diffDocxFiles`/`diffDocxDocs`): changed
 * paragraphs word by word, added and removed ones, formatting changes, and changes to headers,
 * footers, notes, comments, and styles. Unchanged runs collapse around the changes.
 */

const CONTEXT = 1

function propertyLabel(property: string): string {
  switch (property) {
    case 'b': return ui("Bold")
    case 'i': return ui("Italic")
    case 'u': return ui("Underline")
    case 'strike':
    case 'dstrike': return ui("Strikethrough")
    case 'color': return ui("Text color")
    case 'highlight': return ui("Highlight color")
    case 'sz': return ui("Font size")
    case 'rFonts': return ui("Font")
    case 'vertAlign': return ui("Superscript or subscript")
    case 'rStyle': return ui("Character style")
    case 'link': return ui("Link")
    case 'picture': return ui("Picture")
    case 'pStyle': return ui("Style")
    case 'jc': return ui("Alignment")
    case 'ind': return ui("Indentation")
    case 'spacing': return ui("Spacing")
    case 'numPr': return ui("List")
    case 'shd': return ui("Shading")
    case 'pBdr': return ui("Borders")
    case 'tabs': return ui("Tab stops")
    case 'caps':
    case 'smallCaps': return ui("Capitalization")
    default: return property
  }
}

function storyLabel(kind: string): string {
  switch (kind) {
    case 'header': return ui("Header")
    case 'footer': return ui("Footer")
    case 'footnote': return ui("Footnote")
    case 'endnote': return ui("Endnote")
    case 'comment': return ui("Comment")
    default: return kind
  }
}

function Segments({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={index}
          className={cn(
            segment.op === 'insert' && 'rounded-sm bg-green-500/15 text-green-800 underline decoration-green-600/60 dark:text-green-300',
            segment.op === 'delete' && 'rounded-sm bg-red-500/15 text-red-800 line-through decoration-red-600/60 dark:text-red-300',
          )}
          data-op={segment.op}
        >
          {segment.text}
        </span>
      ))}
    </>
  )
}

function BlockText({ block, children }: { block: DiffBlockSummary; children: React.ReactNode }) {
  const heading = block.outline !== undefined && block.outline < 3
  return (
    <p className={cn('whitespace-pre-wrap break-words', heading && 'font-semibold', block.type === 'row' && 'font-mono text-xs')}>
      {block.label && <span className="mr-1.5 text-muted-foreground">{block.label}</span>}
      {children}
    </p>
  )
}

function FormatNotes({ formats }: { formats: FormatChange[] }) {
  if (!formats.length) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {formats.slice(0, 8).map((format, index) => (
        <li key={index}>
          <span className="font-medium text-foreground">{propertyLabel(format.property)}</span>
          {format.text && <> · <span className="italic">“{format.text.length > 60 ? `${format.text.slice(0, 60)}…` : format.text}”</span></>}
          {(format.before || format.after) && <> · {format.before ?? ui("none")} → {format.after ?? ui("none")}</>}
        </li>
      ))}
      {formats.length > 8 && <li>{ui("{{count}} more formatting changes", { count: formats.length - 8 })}</li>}
    </ul>
  )
}

function DiffRow({ block }: { block: DiffBlock }) {
  if (block.kind === 'equal') return <BlockText block={block.block}>{block.block.text || ' '}</BlockText>
  if (block.kind === 'insert' || block.kind === 'delete') {
    return (
      <div data-diff={block.kind} className={cn('-mx-2 border-l-2 px-2', block.kind === 'insert' ? 'border-green-600' : 'border-red-600')}>
        <BlockText block={block.block}><Segments segments={[{ op: block.kind, text: block.block.text || '¶' }]} /></BlockText>
      </div>
    )
  }
  return (
    <div data-diff="modify" className="-mx-2 border-l-2 border-amber-500 px-2">
      <BlockText block={block.after}><Segments segments={block.segments} /></BlockText>
      <FormatNotes formats={block.formats} />
    </div>
  )
}

/** Groups unchanged blocks far from changes into expandable runs. */
function collapse(blocks: DiffBlock[]): (DiffBlock | { kind: 'gap'; blocks: DiffBlock[] })[] {
  const near = blocks.map((_, index) => blocks.slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1).some((block) => block.kind !== 'equal'))
  const result: (DiffBlock | { kind: 'gap'; blocks: DiffBlock[] })[] = []
  blocks.forEach((block, index) => {
    if (block.kind !== 'equal' || near[index]) {
      result.push(block)
      return
    }
    const last = result[result.length - 1]
    if (last?.kind === 'gap') last.blocks.push(block)
    else result.push({ kind: 'gap', blocks: [block] })
  })
  return result
}

export function DocxDiffView({ diff, className }: { diff: DocxDiff; className?: string }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  if (diff.identical && !diff.styles.length) return <p className={cn('p-4 text-sm text-muted-foreground', className)}>{ui("No changes")}</p>
  const rows = collapse(diff.blocks)
  return (
    <div className={cn('flex flex-col gap-3 text-sm', className)} data-docx-diff>
      <p className="text-xs text-muted-foreground">
        {ui("{{inserted}} words added, {{deleted}} removed, {{changed}} paragraphs changed", { inserted: diff.stats.insertedWords, deleted: diff.stats.deletedWords, changed: diff.stats.changedBlocks + diff.stats.insertedBlocks + diff.stats.deletedBlocks })}
      </p>
      <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-4">
        {rows.map((row, index) => {
          if (row.kind !== 'gap') return <DiffRow key={index} block={row} />
          if (expanded.has(index)) return row.blocks.map((block, inner) => <DiffRow key={`${index}-${inner}`} block={block} />)
          return (
            <button
              key={index}
              type="button"
              className="cursor-pointer self-start rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              onClick={() => setExpanded((current) => new Set(current).add(index))}
            >
              {ui("{{count}} unchanged paragraphs", { count: row.blocks.length })}
            </button>
          )
        })}
      </div>
      {diff.stories.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{ui("Headers, footers, notes, and comments")}</h3>
          {diff.stories.map((story) => (
            <div key={story.id} className="rounded-lg border bg-card p-3" data-diff-story={story.kind}>
              <div className="mb-1 text-xs text-muted-foreground">
                {storyLabel(story.kind)}{story.author ? ` · ${story.author}` : ''}
              </div>
              <p className="whitespace-pre-wrap break-words"><Segments segments={story.segments} /></p>
            </div>
          ))}
        </section>
      )}
      {diff.styles.length > 0 && (
        <section className="text-xs text-muted-foreground">
          <h3 className="font-medium">{ui("Styles changed")}</h3>
          <p>{diff.styles.map((style) => style.name).join(', ')}</p>
        </section>
      )}
    </div>
  )
}
