import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Braces, FileCode2, WrapText } from 'lucide-react'
import { codeLanguageFor, fileExtension } from '@pulpo/client-core/files'
import { highlightTree, lineText, markLineRanges, splitHighlightedLines, type HighlightedLine } from '@pulpo/client-core/highlight'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { findInLines, formatJson, MAX_FIND_MATCHES, stepIndex, useFindShortcut } from './find'
import {
  FindBar,
  FindButton,
  ViewerCopyButton,
  ViewerStatus,
  ViewerToggleButton,
  ViewerToolbar,
  ViewerToolbarSpacer,
  ViewModeToggle,
} from './ViewerChrome'

/** Files up to this many characters are highlighted; larger ones show as plain text. */
const MAX_VIEWER_HIGHLIGHT_CHARACTERS = 300_000
const WRAP_KEY = 'pulpo:viewer:wrap'
const MAX_LINE_DISPLAY = 20_000

function isJsonName(name: string, mimeType: string | null | undefined): boolean {
  const extension = fileExtension(name)
  if (extension === 'jsonl' || extension === 'ndjson') return false
  return codeLanguageFor(name, mimeType) === 'json'
}

function readWrapPreference(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) === 'true'
  } catch {
    return false
  }
}

const Line = memo(function Line({ line, ranges, wrap, number, gutter }: {
  line: HighlightedLine
  ranges: readonly { start: number; end: number; current?: boolean }[] | undefined
  wrap: boolean
  number: number
  gutter: number
}) {
  // A single enormous line (minified files) shows its start; copy still has all of it.
  const text = lineText(line)
  const shown = text.length > MAX_LINE_DISPLAY ? [{ type: 'text' as const, value: `${text.slice(0, MAX_LINE_DISPLAY)}…` }] : line
  const content = ranges?.length ? markLineRanges(shown, ranges.filter((range) => range.end <= MAX_LINE_DISPLAY)) : shown
  return (
    <div className={cn('flex min-h-5 font-mono text-xs leading-5', !wrap && 'w-max min-w-full')} data-line={number}>
      <span
        aria-hidden
        className="sticky left-0 shrink-0 select-none bg-code pr-4 pl-4 text-right text-code-muted tabular-nums"
        style={{ width: `calc(${gutter}ch + 2rem)` }}
      >
        {number}
      </span>
      <span className={cn('min-w-0 flex-1 pr-5', wrap ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'whitespace-pre')}>
        {content.length ? toJsxRuntime({ type: 'root', children: content }, { Fragment, jsx, jsxs }) : '​'}
      </span>
    </div>
  )
})

/**
 * Read-only code and text: highlighted by the file's name, with line numbers, soft wrap, copy, and
 * find. Lines are virtualized, so multi-megabyte logs scroll as smoothly as short files. JSON is
 * pretty-printed, with the file as written one click away.
 */
export function CodeViewer({
  text,
  name,
  mimeType,
  language: languageOverride,
  toolbarStart,
  notice,
  className,
}: {
  text: string
  name: string
  mimeType?: string | null
  /** A highlight.js grammar, overriding the one the name implies (`null` for plain text). */
  language?: string | null
  /** Controls placed first in the toolbar, such as a parent viewer's mode toggle. */
  toolbarStart?: ReactNode
  /** A note under the toolbar (the file was cut short, it isn't valid JSON). */
  notice?: ReactNode
  className?: string
}) {
  const [wrap, setWrap] = useState(readWrapPreference)
  const formatted = useMemo(() => (isJsonName(name, mimeType) ? formatJson(text) : null), [mimeType, name, text])
  const [showFormatted, setShowFormatted] = useState(true)
  const shown = formatted !== null && showFormatted ? formatted : text
  const language = languageOverride !== undefined ? languageOverride : codeLanguageFor(name, mimeType)

  // One line-ending style, so highlighted lines and searched lines split the same way.
  const normalized = useMemo(() => shown.replace(/\r\n?/g, '\n'), [shown])
  const tooLargeToHighlight = language !== null && normalized.length > MAX_VIEWER_HIGHLIGHT_CHARACTERS
  const lines = useMemo(() => {
    const tree = language === null ? null : highlightTree(normalized, language, MAX_VIEWER_HIGHLIGHT_CHARACTERS)
    return splitHighlightedLines(normalized, tree)
  }, [language, normalized])
  const plainLines = useMemo(() => normalized.split('\n'), [normalized])

  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const matches = useMemo(() => (findOpen ? findInLines(plainLines, query) : []), [findOpen, plainLines, query])
  const rangesByLine = useMemo(() => {
    const byLine = new Map<number, { start: number; end: number; current?: boolean }[]>()
    matches.forEach((match, index) => {
      const ranges = byLine.get(match.line) ?? []
      ranges.push({ start: match.start, end: match.end, current: index === current })
      byLine.set(match.line, ranges)
    })
    return byLine
  }, [current, matches])

  const listRef = useRef<VirtuosoHandle>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const attachScroller = useCallback((element: HTMLElement | Window | null) => {
    scrollerRef.current = element instanceof HTMLElement ? element : null
  }, [])
  const containerRef = useRef<HTMLDivElement>(null)
  const reveal = useRef(0)
  // Unwrapped lines scroll sideways, so the current match may sit past either edge. Its line
  // renders only after scrolling to it, so look for its mark over the next few frames.
  const revealCurrentMatch = useCallback(() => {
    const token = ++reveal.current
    let frames = 0
    const tick = () => {
      if (token !== reveal.current) return
      const scroller = scrollerRef.current
      const mark = scroller?.querySelector<HTMLElement>('mark.find-match-current')
      if (!scroller || !mark) {
        if (++frames < 12) requestAnimationFrame(tick)
        return
      }
      const view = scroller.getBoundingClientRect()
      // The sticky line numbers cover the left edge.
      const left = view.left + (scroller.querySelector<HTMLElement>('[data-line] > span[aria-hidden]')?.offsetWidth ?? 0)
      const box = mark.getBoundingClientRect()
      if (box.left >= left && box.right <= view.right) return
      scroller.scrollLeft += box.left - left - Math.max(0, (view.right - left - box.width) / 2)
    }
    requestAnimationFrame(tick)
  }, [])
  const goTo = useCallback((index: number) => {
    setCurrent(index)
    const match = matches[index]
    if (match) {
      listRef.current?.scrollToIndex({ index: match.line, align: 'center' })
      revealCurrentMatch()
    }
  }, [matches, revealCurrentMatch])
  const step = (direction: 1 | -1) => {
    if (!findOpen) setFindOpen(true)
    else goTo(stepIndex(current, matches.length, direction))
  }
  const onKeyDown = useFindShortcut(() => setFindOpen(true), step)

  const toggleWrap = () => {
    setWrap((value) => {
      try {
        localStorage.setItem(WRAP_KEY, String(!value))
      } catch {
        // Private windows can refuse storage; the toggle still applies here.
      }
      return !value
    })
  }

  const gutter = String(lines.length).length
  const locale = activeLocale()
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn('flex size-full min-h-0 flex-col bg-code text-code-foreground outline-none', className)}
      data-preview-kind="code"
    >
      <ViewerToolbar>
        {toolbarStart}
        {formatted !== null && (
          <ViewModeToggle
            value={showFormatted ? 'formatted' : 'raw'}
            onChange={(value) => setShowFormatted(value === 'formatted')}
            options={[
              { value: 'formatted', label: ui("Formatted"), icon: Braces },
              { value: 'raw', label: ui("As written"), icon: FileCode2 },
            ]}
          />
        )}
        <ViewerStatus className="hidden sm:inline">
          {lines.length === 1 ? ui("1 line") : uit`${lines.length.toLocaleString(locale)} lines`}
        </ViewerStatus>
        <ViewerToolbarSpacer />
        <ViewerToggleButton pressed={wrap} label={ui("Wrap lines")} onClick={toggleWrap}>
          <WrapText className="size-4" />
        </ViewerToggleButton>
        <FindButton onClick={() => setFindOpen(true)} />
        <ViewerCopyButton text={() => shown} />
      </ViewerToolbar>
      {findOpen && (
        <FindBar
          query={query}
          onQueryChange={(value) => {
            setQuery(value)
            setCurrent(0)
            const first = findInLines(plainLines, value, 1)[0]
            if (first) {
              listRef.current?.scrollToIndex({ index: first.line, align: 'center' })
              revealCurrentMatch()
            }
          }}
          current={current}
          total={matches.length}
          capped={matches.length >= MAX_FIND_MATCHES}
          onNext={() => goTo(stepIndex(current, matches.length, 1))}
          onPrevious={() => goTo(stepIndex(current, matches.length, -1))}
          onClose={() => {
            setFindOpen(false)
            containerRef.current?.focus()
          }}
        />
      )}
      {(notice || tooLargeToHighlight) && (
        <p className="shrink-0 border-b border-code-border bg-code px-4 py-1.5 text-xs text-code-muted">
          {notice}
          {notice && tooLargeToHighlight ? ' ' : null}
          {tooLargeToHighlight && ui("Syntax highlighting is off for files this large.")}
        </p>
      )}
      <Virtuoso
        ref={listRef}
        scrollerRef={attachScroller}
        className="code-highlight min-h-0 flex-1"
        style={{ overflowX: wrap ? 'hidden' : 'auto' }}
        totalCount={lines.length}
        increaseViewportBy={600}
        components={{ Header: ViewerPadding, Footer: ViewerPadding }}
        itemContent={(index) => (
          <Line line={lines[index]!} ranges={rangesByLine.get(index)} wrap={wrap} number={index + 1} gutter={gutter} />
        )}
      />
    </div>
  )
}

function ViewerPadding() {
  return <div className="h-3" />
}
