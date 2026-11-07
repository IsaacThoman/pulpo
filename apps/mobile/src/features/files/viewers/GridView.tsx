import { columnLabel, suggestColumnWidths, type DelimitedTable } from '@pulpo/client-core/office/delimited'
import * as Clipboard from 'expo-clipboard'
import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef } from 'react'
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useAppTheme, type AppTheme } from '../../../theme'

const ROW_HEIGHT = 34
const NUMBER_WIDTH = 52
/** Columns past this are left out on phones; the footer says so. */
export const MAX_NATIVE_GRID_COLUMNS = 150

export interface GridViewHandle {
  /** Scrolls a row (by its index in the file; 0 is the header) into view. */
  scrollToRow(row: number): void
}

/** A cell as one short line: its start, with line breaks as spaces (no regex, so huge cells stay fast). */
function oneLine(value: string): string {
  const start = value.length > 500 ? `${value.slice(0, 500)}…` : value
  return start.includes('\n') ? start.split('\n').map((part) => part.trim()).filter(Boolean).join(' ') : start
}

function isNumeric(value: string): boolean {
  return /^-?[\d.,]+%?$/.test(value)
}

const GridRow = memo(function GridRow({ cells, number, widths, header, match, theme, onPressCell }: {
  cells: string[]
  number: number
  widths: number[]
  header: boolean
  match: 'match' | 'current' | null
  theme: AppTheme
  onPressCell: (column: number, value: string) => void
}) {
  const query = match ? (match === 'current' ? 'rgba(249,115,22,0.30)' : 'rgba(250,204,21,0.22)') : undefined
  return (
    <View style={[styles.row, { borderBottomColor: theme.separator, backgroundColor: query ?? (header ? theme.elevated : number % 2 ? theme.elevated : theme.background) }]}>
      <Text style={[styles.number, { color: theme.tertiary, borderRightColor: theme.separator }]}>{number}</Text>
      {widths.map((width, column) => {
        const value = cells[column] ?? ''
        return (
          <Pressable
            key={column}
            onPress={value ? () => onPressCell(column, value) : undefined}
            style={[styles.cell, { width, borderRightColor: theme.separator }]}
            accessibilityRole={value ? 'button' : undefined}
          >
            <Text numberOfLines={1} style={[styles.cellText, { color: theme.text, textAlign: !header && isNumeric(value) ? 'right' : 'left' }, header ? styles.headerText : null]}>
              {oneLine(value)}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
})

/**
 * A CSV/TSV file as a native grid: column letters and the header row stay on top, rows are
 * virtualized (fixed height, so 100k+ rows scroll and jump instantly), and the whole grid scrolls
 * sideways. Tapping a cell shows its full value, which can be copied.
 */
export const GridView = forwardRef<GridViewHandle, {
  table: DelimitedTable
  matchRows: ReadonlySet<number>
  currentRow: number | undefined
  bottomInset: number
  query: string
}>(function GridView({ table, matchRows, currentRow, bottomInset, query }, ref) {
  const theme = useAppTheme()
  const listRef = useRef<FlatList<number>>(null)
  const horizontalRef = useRef<ScrollView>(null)
  const viewportWidth = useRef(0)
  const columnCount = Math.min(table.columnCount, MAX_NATIVE_GRID_COLUMNS)
  const widths = useMemo(
    () => suggestColumnWidths(table, { characterWidth: 8.2, padding: 24, min: 56, max: 300 }).slice(0, columnCount),
    [columnCount, table],
  )
  const header = useMemo(() => table.row(0), [table])
  const rows = useMemo(() => Array.from({ length: table.rowCount - 1 }, (_, index) => index + 1), [table])
  const width = NUMBER_WIDTH + widths.reduce((sum, value) => sum + value, 0)

  useImperativeHandle(ref, () => ({
    scrollToRow(row) {
      if (row > 0) listRef.current?.scrollToIndex({ index: row - 1, viewPosition: 0.4, animated: true })
      // The selected row can match a cell beyond the screen, including in the sticky header.
      const needle = query.toLowerCase()
      const column = needle ? table.row(row).slice(0, columnCount).findIndex((cell) => cell.toLowerCase().includes(needle)) : -1
      if (column < 0) return
      const left = widths.slice(0, column).reduce((sum, value) => sum + value, 0)
      const available = Math.max(0, viewportWidth.current - NUMBER_WIDTH)
      horizontalRef.current?.scrollTo({ x: Math.max(0, left - Math.max(0, available - widths[column]!) / 2), animated: true })
    },
  }), [columnCount, query, table, widths])

  const showCell = useCallback((column: number, value: string) => {
    Alert.alert(header[column] || columnLabel(column), value.length > 5_000 ? `${value.slice(0, 5_000)}…` : value, [
      { text: 'Copy', onPress: () => { void Clipboard.setStringAsync(value) } },
      { text: 'Done', style: 'cancel' },
    ])
  }, [header])

  const renderItem = useCallback(({ item }: { item: number }) => (
    <GridRow
      cells={table.row(item)}
      number={item + 1}
      widths={widths}
      header={false}
      match={item === currentRow ? 'current' : matchRows.has(item) ? 'match' : null}
      theme={theme}
      onPressCell={showCell}
    />
  ), [currentRow, matchRows, showCell, table, theme, widths])

  const columnLetters = (
    <View style={[styles.row, styles.letters, { borderBottomColor: theme.separator, backgroundColor: theme.elevated2 }]}>
      <View style={[styles.number, { borderRightColor: theme.separator }]} />
      {widths.map((columnWidth, column) => (
        <Text key={column} style={[styles.letter, { width: columnWidth, color: theme.secondary, borderRightColor: theme.separator }]}>{columnLabel(column)}</Text>
      ))}
    </View>
  )

  return (
    <ScrollView ref={horizontalRef} horizontal style={styles.flex} contentContainerStyle={styles.horizontal} directionalLockEnabled onLayout={(event) => { viewportWidth.current = event.nativeEvent.layout.width }}>
      <FlatList
        ref={listRef}
        style={{ width }}
        data={rows}
        keyExtractor={String}
        renderItem={renderItem}
        extraData={matchRows}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={(
          <View>
            {columnLetters}
            <GridRow cells={header} number={1} widths={widths} header match={currentRow === 0 ? 'current' : matchRows.has(0) ? 'match' : null} theme={theme} onPressCell={showCell} />
          </View>
        )}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index + 26 + ROW_HEIGHT, index })}
        initialNumToRender={30}
        maxToRenderPerBatch={40}
        windowSize={11}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
        testID="grid-view"
      />
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  flex: { flex: 1 },
  horizontal: { flexGrow: 1 },
  row: { flexDirection: 'row', height: ROW_HEIGHT, borderBottomWidth: StyleSheet.hairlineWidth },
  letters: { height: 26 },
  number: { width: NUMBER_WIDTH, fontSize: 12, lineHeight: ROW_HEIGHT, textAlign: 'right', paddingRight: 8, borderRightWidth: StyleSheet.hairlineWidth, fontVariant: ['tabular-nums'] },
  letter: { fontSize: 11, lineHeight: 26, textAlign: 'center', borderRightWidth: StyleSheet.hairlineWidth },
  cell: { justifyContent: 'center', paddingHorizontal: 9, borderRightWidth: StyleSheet.hairlineWidth },
  cellText: { fontSize: 13, fontVariant: ['tabular-nums'] },
  headerText: { fontWeight: '600' },
})
