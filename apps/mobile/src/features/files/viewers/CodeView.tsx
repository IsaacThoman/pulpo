import { HIGHLIGHT_COLORS, highlightRuns, type HighlightedLine, type LineMatch } from '@pulpo/client-core/highlight'
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
}

type Ranges = { start: number; end: number; current?: boolean }[]

const CodeLine = memo(function CodeLine({ line, number, gutter, ranges, wrap, theme }: {
  line: HighlightedLine
  number: number
  gutter: number
  ranges: Ranges | undefined
  wrap: boolean
  theme: AppTheme
}) {
  const colors = HIGHLIGHT_COLORS[theme.isDark ? 'dark' : 'light']
  const runs = highlightRuns(line, ranges)
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
  const gutter = Math.max(2, String(lines.length).length) * CHARACTER_WIDTH + 16
  const longest = useMemo(() => plain.reduce((max, line) => Math.max(max, Math.min(line.length, 4_000)), 0), [plain])
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

  useImperativeHandle(ref, () => ({
    scrollToLine(line) {
      listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(line, lines.length - 1)), viewPosition: 0.4, animated: true })
    },
  }), [lines.length])

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
    <ScrollView horizontal style={styles.flex} contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator>
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
