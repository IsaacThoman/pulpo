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
  for (const interval of columnIntervals(sheet)) if (col >= interval.from && col <= interval.to) Object.assign(props, interval.props)
  return props
}
