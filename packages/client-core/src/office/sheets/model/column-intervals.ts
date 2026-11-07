import { cachedSheetRead } from './read-cache.js'
import { RangeLookup } from '../range-lookup.js'
import { MAX_COLS } from '../address.js'
import type { AxisProps } from './schema.js'
import type { SheetModel } from './workbook.js'

export interface ColumnInterval {
  from: number
  to: number
  props: Partial<AxisProps>
}

/** Older documents stored just one interval, with an optional grid-ending bound. */
export function columnIntervals(sheet: SheetModel): ColumnInterval[] {
  const raw = sheet.raw.get('colTail') as ColumnInterval[] | (Omit<ColumnInterval, 'to'> & { to?: number }) | undefined
  return Array.isArray(raw) ? raw : raw ? [{ ...raw, to: raw.to ?? MAX_COLS - 1 }] : []
}

/** Later intervals override earlier ones, as they do in worksheet XML. */
export function columnIntervalProps(sheet: SheetModel, col: number): Partial<AxisProps> {
  const props: Partial<AxisProps> = {}
  const index = cachedSheetRead(sheet.workbook.doc, sheet.map, 'columnIntervals', () => new RangeLookup(columnIntervals(sheet), (interval) => [{ top: 0, bottom: 0, left: interval.from, right: interval.to }]))
  for (const interval of index.overlapping({ top: 0, bottom: 0, left: col, right: col })) Object.assign(props, interval.props)
  return props
}
