import { useEffect, useMemo, useState } from 'react'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { assetObjectUrl, DeckResources, displayableMediaType, renderSlide, type PresentationDiff, type PresentationSnapshot, type ShapeChangeKind, type SlideDiff } from '@pulpo/client-core/office/presentation'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { MarkdownDiff } from '@/features/files/MarkdownDiff'
import { presentationLabels } from './labels'

/**
 * Review of a proposed deck: one row per slide that changed, with before and after thumbnails
 * and what changed on it, text changes shown as a line diff.
 */

const STATUS_LABELS: Record<SlideDiff['status'], () => string> = {
  added: () => ui("Added"),
  removed: () => ui("Removed"),
  moved: () => ui("Moved"),
  edited: () => ui("Edited"),
  unchanged: () => ui("Unchanged"),
}

const SHAPE_CHANGE_LABELS: Record<ShapeChangeKind, () => string> = {
  added: () => ui("added"),
  removed: () => ui("removed"),
  text: () => ui("text changed"),
  formatting: () => ui("formatting changed"),
  moved: () => ui("moved"),
  resized: () => ui("resized"),
  rotated: () => ui("rotated or flipped"),
  fill: () => ui("fill changed"),
  line: () => ui("outline changed"),
  geometry: () => ui("shape changed"),
  image: () => ui("picture replaced"),
  table: () => ui("table changed"),
  other: () => ui("changed"),
}

const SLIDE_CHANGE_LABELS: Record<string, () => string> = {
  layout: () => ui("Layout changed"),
  hidden: () => ui("Slide hidden"),
  shown: () => ui("Slide shown"),
  background: () => ui("Background changed"),
  notes: () => ui("Speaker notes changed"),
  transition: () => ui("Transition or animation changed"),
  order: () => ui("Stacking order changed"),
}

/** Loads images of one snapshot as object URLs, for thumbnails. */
function useAssetUrls(snapshot: PresentationSnapshot, assets: LiveAssetStore | undefined): Map<string, string> {
  const [urls, setUrls] = useState(() => new Map<string, string>())
  useEffect(() => {
    if (!assets) return
    let cancelled = false
    const created: string[] = []
    void (async () => {
      const next = new Map<string, string>()
      for (const [path, part] of Object.entries(snapshot.parts)) {
        if (!part.asset?.mimeType.startsWith('image/') || !displayableMediaType(part.asset.mimeType)) continue
        try {
          const url = assetObjectUrl(await assets.get(part.asset.hash), part.asset.mimeType)
          if (!url) continue
          if (url.startsWith('blob:')) created.push(url)
          next.set(path, url)
        } catch {
          // A missing image draws as a gray box.
        }
      }
      if (!cancelled) setUrls(next)
    })()
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [snapshot, assets])
  return urls
}

function Thumbnail({ snapshot, slideKey, deck, urls, label }: { snapshot: PresentationSnapshot; slideKey?: string; deck: DeckResources; urls: Map<string, string>; label: string }) {
  const html = useMemo(() => {
    const index = snapshot.slides.findIndex((slide) => slide.key === slideKey)
    const slide = snapshot.slides[index]
    if (!slide) return ''
    return renderSlide(slide, snapshot, { deck, slideNumber: index + 1, mode: 'view', labels: presentationLabels(), assetUrl: (path) => urls.get(path), idPrefix: `diff-${label}-${slideKey}` })
  }, [snapshot, slideKey, deck, urls, label])
  const width = 220
  const scale = width / (snapshot.slideWidth / 9525)
  if (!html) return <div className="aspect-video w-[220px] rounded border border-dashed bg-muted/40" aria-hidden />
  return (
    <figure className="flex flex-col gap-1">
      <div className="relative overflow-hidden rounded border bg-white" style={{ width, height: (snapshot.slideHeight / 9525) * scale }}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `scale(${scale})` }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  )
}

export function PresentationDiffView({ diff, beforeAssets, afterAssets, showUnchanged = false }: { diff: PresentationDiff; beforeAssets?: LiveAssetStore; afterAssets?: LiveAssetStore; showUnchanged?: boolean }) {
  const beforeDeck = useMemo(() => new DeckResources(diff.beforeSnapshot.parts, diff.beforeSnapshot.mainPart), [diff.beforeSnapshot])
  const afterDeck = useMemo(() => new DeckResources(diff.afterSnapshot.parts, diff.afterSnapshot.mainPart), [diff.afterSnapshot])
  const beforeUrls = useAssetUrls(diff.beforeSnapshot, beforeAssets)
  const afterUrls = useAssetUrls(diff.afterSnapshot, afterAssets ?? beforeAssets)
  const rows = diff.slides.filter((slide) => showUnchanged || slide.status !== 'unchanged')
  return (
    <div className="flex flex-col gap-3" data-presentation-diff="">
      <p className="text-sm text-muted-foreground" role="status">
        {diff.changed ? uit`${diff.added} added · ${diff.removed} removed · ${diff.moved} moved · ${diff.edited} edited` : ui("No changes")}
        {diff.deck.includes('theme') || diff.deck.includes('masters') ? ` · ${ui("Theme or slide masters changed")}` : ''}
        {diff.deck.includes('size') ? ` · ${ui("Slide size changed")}` : ''}
      </p>
      {rows.map((row, index) => (
        <article key={`${row.beforeKey ?? ''}-${row.afterKey ?? ''}-${index}`} className="rounded-lg border p-3" data-status={row.status}>
          <header className="mb-2 flex items-center gap-2 text-sm">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium',
                row.status === 'added' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                row.status === 'removed' && 'bg-red-500/15 text-red-700 dark:text-red-300',
                row.status === 'moved' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                row.status === 'edited' && 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
              )}
            >
              {STATUS_LABELS[row.status]()}
            </span>
            <span className="font-medium">
              {row.after !== undefined ? uit`Slide ${row.after + 1}` : uit`Slide ${(row.before ?? 0) + 1}`}
              {row.status === 'moved' && row.before !== undefined && row.after !== undefined ? ` (${uit`was ${row.before + 1}`})` : ''}
            </span>
            {row.title && <span className="truncate text-muted-foreground">{row.title}</span>}
          </header>
          <div className="flex flex-wrap gap-4">
            {row.status !== 'added' && <Thumbnail snapshot={diff.beforeSnapshot} slideKey={row.beforeKey} deck={beforeDeck} urls={beforeUrls} label={ui("Before")} />}
            {row.status !== 'removed' && <Thumbnail snapshot={diff.afterSnapshot} slideKey={row.afterKey} deck={afterDeck} urls={afterUrls} label={ui("After")} />}
            <ul className="min-w-56 flex-1 space-y-2 text-sm">
              {row.slideChanges.map((change) => (
                <li key={change}>{SLIDE_CHANGE_LABELS[change]?.() ?? change}</li>
              ))}
              {row.shapes.map((shape) => (
                <li key={shape.key} className="space-y-1">
                  <span>
                    <span className="font-medium">{shape.name || ui("Shape")}</span>: {shape.kinds.map((kind) => SHAPE_CHANGE_LABELS[kind]()).join(', ')}
                  </span>
                  {(shape.kinds.includes('text') || shape.kinds.includes('table')) && <MarkdownDiff before={shape.textBefore ?? ''} after={shape.textAfter ?? ''} className="max-h-48" />}
                </li>
              ))}
              {row.notesBefore !== undefined && <MarkdownDiff before={row.notesBefore} after={row.notesAfter ?? ''} className="max-h-40" />}
            </ul>
          </div>
        </article>
      ))}
    </div>
  )
}
