import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { TableVirtuoso, type TableComponents, type TableVirtuosoHandle } from 'react-virtuoso'
import { FileText, Table2 } from 'lucide-react'
import { declaredDelimiter } from '@pulpo/client-core/files'
import { columnLabel, indexDelimited, type DelimitedTable } from '@pulpo/client-core/office/delimited'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { CodeViewer } from './CodeViewer'
import { FindBar, FindButton, ViewerCopyButton, ViewerStatus, ViewerToolbar, ViewerToolbarSpacer, ViewModeToggle } from './ViewerChrome'
import { columnWindow, initialColumnWidths, MAX_FIND_ROWS, stepIndex, useFindShortcut } from './find'

const ROW_NUMBER_WIDTH = 56
const MIN_COLUMN_WIDTH = 48
const MAX_COLUMN_WIDTH = 640

// Fixed table layout needs an explicit width; it changes as columns resize.
const TableWidth = createContext(0)

function GridTable({ style, ...props }: React.ComponentProps<'table'>) {
  const width = useContext(TableWidth)
  return <table {...props} style={{ ...style, width, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }} className="text-left text-xs" />
}

// Stable component identities, so scrolling never remounts the table.
const tableComponents: TableComponents<number> = {
  Table: GridTable,
  TableRow: ({ item: _item, ...props }) => <tr {...props} className="group/row" />,
}

function delimiterName(delimiter: string): string {
  switch (delimiter) {
    case '\t': return ui("Tab-separated")
    case ';': return ui("Semicolon-separated")
    case '|': return ui("Pipe-separated")
    default: return ui("Comma-separated")
  }
}

/**
 * CSV/TSV as a spreadsheet-like grid: column letters and the header row stay at the top and row
 * numbers at the left, columns can be resized (double-click a divider to fit), and only the rows
 * and columns on screen are rendered, so files with 100k+ rows scroll smoothly. A Text mode shows
 * the file as written, and find highlights matching cells.
 */
export function DelimitedGrid({ text, name, mimeType, className }: { text: string; name: string; mimeType?: string | null; className?: string }) {
  const table = useMemo(() => indexDelimited(text, { declared: declaredDelimiter(name, mimeType) ?? ',' }), [mimeType, name, text])
  const [mode, setMode] = useState<'grid' | 'text'>('grid')
  const modeToggle = (
    <ViewModeToggle
      value={mode}
      onChange={setMode}
      options={[
        { value: 'grid', label: ui("Show as table"), icon: Table2 },
        { value: 'text', label: ui("Show as text"), icon: FileText },
      ]}
    />
  )
  // One column is not a table; such files read better as text.
  if (table.rowCount === 0 || table.columnCount < 2) return <CodeViewer text={text} name={name} mimeType={mimeType} language={null} className={className} />
  if (mode === 'text') return <CodeViewer text={text} name={name} mimeType={mimeType} language={null} toolbarStart={modeToggle} className={className} />
  return <Grid table={table} text={text} toolbarStart={modeToggle} className={className} />
}

function Grid({ table, text, toolbarStart, className }: { table: DelimitedTable; text: string; toolbarStart: ReactNode; className?: string }) {
  const header = useMemo(() => table.row(0), [table])
  const [widths, setWidths] = useState(() => initialColumnWidths(table, MIN_COLUMN_WIDTH, 320))
  const offsets = useMemo(() => {
    const result = [0]
    for (const width of widths) result.push(result[result.length - 1]! + width)
    return result
  }, [widths])

  // Only the columns in view (plus a margin) render; the rest are spacer cells of the same width.
  const [viewport, setViewport] = useState({ left: 0, width: 1600 })
  const scrollerRef = useRef<HTMLElement | null>(null)
  const frame = useRef(0)
  const attachScroller = useCallback((element: HTMLElement | Window | null) => {
    scrollerRef.current = element instanceof HTMLElement ? element : null
  }, [])
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const update = () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        setViewport((current) => {
          const next = { left: scroller.scrollLeft, width: scroller.clientWidth || current.width }
          return Math.abs(next.left - current.left) < 40 && next.width === current.width ? current : next
        })
      })
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(scroller)
    return () => {
      cancelAnimationFrame(frame.current)
      scroller.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [])
  const [first, last] = columnWindow(offsets, viewport.left - ROW_NUMBER_WIDTH, viewport.width, 400)
  const leftPad = offsets[first]!
  const rightPad = offsets[offsets.length - 1]! - offsets[last + 1]!
  const totalWidth = ROW_NUMBER_WIDTH + offsets[offsets.length - 1]!

  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const matchRows = useMemo(() => (findOpen && query ? table.findRows(query, MAX_FIND_ROWS) : []), [findOpen, query, table])
  const needle = findOpen ? query.toLowerCase() : ''
  const currentRow = matchRows[current]
  const listRef = useRef<TableVirtuosoHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollToRow = useCallback((row: number | undefined) => {
    // Row 0 is the sticky header, always in view.
    if (row !== undefined && row > 0) listRef.current?.scrollToIndex({ index: row - 1, align: 'center' })
  }, [])
  const goTo = (index: number) => {
    setCurrent(index)
    scrollToRow(matchRows[index])
  }
  const step = (direction: 1 | -1) => {
    if (!findOpen) setFindOpen(true)
    else goTo(stepIndex(current, matchRows.length, direction))
  }
  const onKeyDown = useFindShortcut(() => setFindOpen(true), step)

  const resize = (column: number, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widths[column]!
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      const width = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX)))
      setWidths((current) => current[column] === width ? current : current.map((value, index) => (index === column ? width : value)))
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }
  const autofit = (column: number) => {
    const fitted = initialColumnWidths(table, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, column)
    setWidths((current) => current.map((value, index) => (index === column ? fitted[column]! : value)))
  }

  const cellStyle = (column: number): CSSProperties => {
    const width = widths[column]!
    return { width, minWidth: width, maxWidth: width }
  }
  const spacer = (width: number, as: 'td' | 'th') => {
    if (width <= 0) return null
    const Tag = as
    return <Tag aria-hidden style={{ width, minWidth: width, maxWidth: width, padding: 0 }} className="border-b" />
  }
  const columns = Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
  const highlight = (value: string) => Boolean(needle) && value.toLowerCase().includes(needle)
  const locale = activeLocale()

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn('flex size-full min-h-0 flex-col bg-background outline-none', className)}
      data-preview-kind="table"
    >
      <ViewerToolbar>
        {toolbarStart}
        <ViewerStatus className="hidden sm:inline">{delimiterName(table.delimiter)}</ViewerStatus>
        <ViewerToolbarSpacer />
        <FindButton onClick={() => setFindOpen(true)} />
        <ViewerCopyButton text={() => text} />
      </ViewerToolbar>
      {findOpen && (
        <FindBar
          query={query}
          onQueryChange={(value) => {
            setQuery(value)
            setCurrent(0)
            scrollToRow(value ? table.findRows(value, 1)[0] : undefined)
          }}
          current={current}
          total={matchRows.length}
          capped={matchRows.length >= MAX_FIND_ROWS}
          onNext={() => goTo(stepIndex(current, matchRows.length, 1))}
          onPrevious={() => goTo(stepIndex(current, matchRows.length, -1))}
          onClose={() => {
            setFindOpen(false)
            containerRef.current?.focus()
          }}
        />
      )}
      <TableWidth.Provider value={totalWidth}>
      <TableVirtuoso
        ref={listRef}
        scrollerRef={attachScroller}
        className="min-h-0 flex-1"
        style={{ width: '100%' }}
        totalCount={table.rowCount - 1}
        increaseViewportBy={400}
        components={tableComponents}
        fixedHeaderContent={() => (
          <>
            <tr className="bg-muted/95 backdrop-blur">
              <th
                aria-hidden
                style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
                className="sticky left-0 z-20 border-r border-b bg-muted"
              />
              {spacer(leftPad, 'th')}
              {columns.map((column) => (
                <th key={column} style={cellStyle(column)} className="relative border-r border-b px-2 py-1 text-center font-normal text-muted-foreground" scope="col">
                  {columnLabel(column)}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={uit`Resize column ${columnLabel(column)}`}
                    title={ui("Drag to resize, double-click to fit")}
                    onPointerDown={(event) => resize(column, event)}
                    onDoubleClick={() => autofit(column)}
                    className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-primary/30"
                  />
                </th>
              ))}
              {spacer(rightPad, 'th')}
            </tr>
            <tr className="bg-background/95 backdrop-blur" data-header-row>
              <th
                style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
                className="sticky left-0 z-20 border-r border-b bg-muted px-2 py-1.5 text-right font-normal text-muted-foreground tabular-nums"
              >
                1
              </th>
              {spacer(leftPad, 'th')}
              {columns.map((column) => {
                const value = header[column] ?? ''
                return (
                  <th
                    key={column}
                    title={value || undefined}
                    style={cellStyle(column)}
                    className={cn('truncate border-r border-b px-2 py-1.5 font-semibold', highlight(value) && (currentRow === 0 ? 'bg-amber-300/70 dark:bg-amber-500/50' : 'bg-amber-200/60 dark:bg-amber-400/25'))}
                  >
                    {value}
                  </th>
                )
              })}
              {spacer(rightPad, 'th')}
            </tr>
          </>
        )}
        itemContent={(index) => {
          const rowIndex = index + 1
          const row = table.row(rowIndex)
          const isCurrent = rowIndex === currentRow
          return (
            <>
              <td
                style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
                className={cn('sticky left-0 z-10 border-r border-b bg-muted px-2 py-1 text-right text-muted-foreground tabular-nums', isCurrent && 'text-foreground')}
              >
                {(rowIndex + 1).toLocaleString(locale)}
              </td>
              {spacer(leftPad, 'td')}
              {columns.map((column) => {
                const value = row[column] ?? ''
                return (
                  <td
                    key={column}
                    title={value.length > 12 ? value : undefined}
                    style={cellStyle(column)}
                    className={cn(
                      'truncate border-r border-b px-2 py-1 group-hover/row:bg-muted/40',
                      /^-?[\d.,]+%?$/.test(value) && 'text-right tabular-nums',
                      highlight(value) && (isCurrent ? 'bg-amber-300/70 dark:bg-amber-500/50' : 'bg-amber-200/60 dark:bg-amber-400/25'),
                    )}
                  >
                    {value}
                  </td>
                )
              })}
              {spacer(rightPad, 'td')}
            </>
          )
        }}
      />
      </TableWidth.Provider>
      <p className="shrink-0 border-t bg-background/95 px-3 py-1.5 text-xs text-muted-foreground tabular-nums" role="status" data-grid-summary style={{ minWidth: 0 }}>
        {uit`${table.rowCount.toLocaleString(locale)} rows · ${table.columnCount.toLocaleString(locale)} columns`}
        {table.sourceColumnCount > table.columnCount && ` · ${uit`Showing the first ${table.columnCount.toLocaleString(locale)} of ${table.sourceColumnCount.toLocaleString(locale)} columns`}`}
        {table.truncated && ` · ${ui("Showing the first part of the file")}`}
      </p>
    </div>
  )
}
