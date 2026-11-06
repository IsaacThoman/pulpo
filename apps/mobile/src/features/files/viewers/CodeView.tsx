import { HIGHLIGHT_COLORS, highlightRuns, type HighlightedLine, type HighlightRun, type LineMatch } from '@pulpo/client-core/highlight'
import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef } from 'react'
import { FlatList, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useAppTheme, type AppTheme } from '../../../theme'

const FONT_SIZE = 12.5
const LINE_HEIGHT = 19
// Menlo and Roboto Mono at 12.5pt; used to size the unwrapped column so it scrolls sideways.
const CHARACTER_WIDTH = 7.55
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' })

export interface CodeViewHandle {
  scrollToLine(line: number): void
  /** Scrolls to a find match, sideways too when an unwrapped line runs past the screen. */
  scrollToMatch(match: Pick<LineMatch, 'line' | 'start' | 'end'>): void
}

type Ranges = { start: number; end: number; current?: boolean }[]

/** One enormous line (minified files) shows its start; copy still has all of it. */
const MAX_LINE_DISPLAY = 10_000

const TAB_COLUMNS = 4

/** Display width of the visible prefix; search offsets and copying still use the original text. */
function codeColumns(text: string, end = text.length): number {
  let columns = 0
  const length = Math.min(end, text.length, MAX_LINE_DISPLAY)
  for (let index = 0; index < length; index++) columns += text[index] === '\t' ? TAB_COLUMNS - columns % TAB_COLUMNS : 1
  return columns
}

/** Android Text collapses tabs; expand only the capped visible runs, retaining token/find styles. */
function expandCodeTabs(runs: HighlightRun[]): HighlightRun[] {
  let columns = 0
  return runs.map((run) => ({
    ...run,
    text: run.text.replace(/\t|[^\t]+/g, (part) => {
      if (part !== '\t') {
        columns += part.length
        return part
      }
      const spaces = TAB_COLUMNS - columns % TAB_COLUMNS
      columns += spaces
      return ' '.repeat(spaces)
    }),
  }))
}

function capRuns(runs: HighlightRun[]): HighlightRun[] {
  let length = 0
  const capped: HighlightRun[] = []
  for (const run of runs) {
    if (length + run.text.length > MAX_LINE_DISPLAY) {
      capped.push({ ...run, text: `${run.text.slice(0, MAX_LINE_DISPLAY - length)}…` })
      return capped
    }
    capped.push(run)
    length += run.text.length
  }
  return capped
}

const CodeLine = memo(function CodeLine({ line, number, gutter, ranges, wrap, theme }: {
  line: HighlightedLine
  number: number
  gutter: number
  ranges: Ranges | undefined
  wrap: boolean
  theme: AppTheme
}) {
  const colors = HIGHLIGHT_COLORS[theme.isDark ? 'dark' : 'light']
  const runs = expandCodeTabs(capRuns(highlightRuns(line, ranges)))
  return (
    <View style={styles.line}>
      <Text style={[styles.number, { width: gutter, color: theme.tertiary }]} accessibilityElementsHidden importantForAccessibility="no">{number}</Text>
      <Text style={[styles.code, { color: theme.text }, wrap ? styles.wrapped : null]} selectable>
        {runs.length ? runs.map((run, index) => (
          <Text
            key={index}
            style={[
              run.token ? { color: colors[run.token] } : null,
              run.token === 'comment' ? styles.italic : null,
              run.match ? { backgroundColor: run.match === 'current' ? 'rgba(249,115,22,0.55)' : 'rgba(250,204,21,0.38)' } : null,
            ]}
          >
            {run.text}
          </Text>
        )) : ' '}
      </Text>
    </View>
  )
})

/**
 * Highlighted code or text with line numbers, drawn natively: lines are virtualized, so long logs
 * scroll smoothly. Unwrapped lines scroll sideways together; find matches are marked in place.
 */
export const CodeView = forwardRef<CodeViewHandle, {
  lines: HighlightedLine[]
  plain: string[]
  wrap: boolean
  matches: LineMatch[]
  current: number
  bottomInset: number
}>(function CodeView({ lines, plain, wrap, matches, current, bottomInset }, ref) {
  const theme = useAppTheme()
  const listRef = useRef<FlatList<number>>(null)
  const horizontalRef = useRef<ScrollView>(null)
  // Where the sideways scroll sits and how wide the screen is, to tell whether a match shows.
  const horizontal = useRef({ x: 0, width: 0 })
  const gutter = Math.max(2, String(lines.length).length) * CHARACTER_WIDTH + 16
  const longest = useMemo(() => plain.reduce((max, line) => Math.max(max, codeColumns(line)), 0), [plain])
  const width = gutter + longest * CHARACTER_WIDTH + 32
  const indexes = useMemo(() => Array.from({ length: lines.length }, (_, index) => index), [lines.length])
  const rangesByLine = useMemo(() => {
    const byLine = new Map<number, Ranges>()
    matches.forEach((match, index) => {
      const ranges = byLine.get(match.line) ?? []
      ranges.push({ start: match.start, end: match.end, current: index === current })
      byLine.set(match.line, ranges)
    })
    return byLine
  }, [current, matches])

  useImperativeHandle(ref, () => {
    const scrollToLine = (line: number) => {
      listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(line, lines.length - 1)), viewPosition: 0.4, animated: true })
    }
    return {
      scrollToLine,
      scrollToMatch(match) {
        scrollToLine(match.line)
        if (wrap || match.start >= MAX_LINE_DISPLAY) return
        // Monospaced, so a column's position follows from the character width the layout uses.
        const source = plain[match.line] ?? ''
        const left = gutter + codeColumns(source, match.start) * CHARACTER_WIDTH
        const right = gutter + codeColumns(source, match.end) * CHARACTER_WIDTH
        const { x, width: view } = horizontal.current
        if (!view || (left >= x && right <= x + view)) return
        horizontalRef.current?.scrollTo({ x: Math.max(0, left - view * 0.3), animated: true })
      },
    }
  }, [gutter, lines.length, plain, wrap])

  const renderItem = useCallback(({ item }: { item: number }) => (
    <CodeLine line={lines[item]!} number={item + 1} gutter={gutter} ranges={rangesByLine.get(item)} wrap={wrap} theme={theme} />
  ), [gutter, lines, rangesByLine, theme, wrap])

  const list = (
    <FlatList
      ref={listRef}
      data={indexes}
      keyExtractor={String}
      renderItem={renderItem}
      extraData={rangesByLine}
      initialNumToRender={60}
      maxToRenderPerBatch={80}
      windowSize={15}
      // Unwrapped lines all have one height, so jumps to a match land exactly.
      getItemLayout={wrap ? undefined : (_, index) => ({ length: LINE_HEIGHT, offset: LINE_HEIGHT * index + 10, index })}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })
        setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.4, animated: false }), 60)
      }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: 10, paddingBottom: bottomInset + 24 }}
      style={wrap ? styles.flex : { width: Math.max(width, 1) }}
      testID="code-view"
    />
  )
  if (wrap) return list
  return (
    <ScrollView
      ref={horizontalRef}
      horizontal
      style={styles.flex}
      contentContainerStyle={styles.horizontal}
      showsHorizontalScrollIndicator
      scrollEventThrottle={32}
      onScroll={(event) => { horizontal.current.x = event.nativeEvent.contentOffset.x }}
      onLayout={(event) => { horizontal.current.width = event.nativeEvent.layout.width }}
    >
      {list}
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  flex: { flex: 1 },
  horizontal: { flexGrow: 1 },
  line: { flexDirection: 'row', minHeight: LINE_HEIGHT },
  number: { fontFamily: MONO, fontSize: FONT_SIZE - 1, lineHeight: LINE_HEIGHT, textAlign: 'right', paddingRight: 12 },
  code: { fontFamily: MONO, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, paddingRight: 16 },
  wrapped: { flex: 1, flexShrink: 1 },
  italic: { fontStyle: 'italic' },
})
