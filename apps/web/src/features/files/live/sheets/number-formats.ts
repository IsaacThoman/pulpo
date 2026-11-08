import type { QuickFormat, SheetView } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'

export interface NumberFormatChoice {
  /** A stable id for menus and tests. */
  id: string
  label: () => string
  code: string
  example: string
  /** The format shortcut (Ctrl+Shift+1…6, Ctrl+Shift+`) that applies it: its code is the view's. */
  quick?: QuickFormat
  /** Menus put a separator between groups, as Google Sheets' Format ▸ Number does. */
  group: number
}

/** The number format menu: common formats with an example of each. */
export const NUMBER_FORMATS: NumberFormatChoice[] = [
  { id: 'automatic', label: () => ui("Automatic"), code: 'General', example: '1000.12', quick: 'general', group: 0 },
  { id: 'plain-text', label: () => ui("Plain text"), code: '@', example: 'abc', group: 0 },
  { id: 'number', label: () => ui("Number"), code: '#,##0.00', example: '1,000.12', quick: 'number', group: 1 },
  { id: 'percent', label: () => ui("Percent"), code: '0.00%', example: '10.12%', quick: 'percent', group: 1 },
  { id: 'scientific', label: () => ui("Scientific"), code: '0.00E+00', example: '1.01E+03', quick: 'scientific', group: 1 },
  { id: 'accounting', label: () => ui("Accounting"), code: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', example: '$ 1,000.12', group: 2 },
  { id: 'currency', label: () => ui("Currency"), code: '"$"#,##0.00', example: '$1,000.12', quick: 'currency', group: 2 },
  { id: 'currency-rounded', label: () => ui("Currency rounded"), code: '"$"#,##0', example: '$1,000', group: 2 },
  { id: 'date', label: () => ui("Date"), code: 'm/d/yyyy', example: '9/26/2008', quick: 'date', group: 3 },
  { id: 'long-date', label: () => ui("Long date"), code: 'dddd, mmmm d, yyyy', example: 'Friday, September 26, 2008', group: 3 },
  { id: 'time', label: () => ui("Time"), code: 'h:mm:ss AM/PM', example: '3:59:00 PM', quick: 'time', group: 3 },
  { id: 'date-time', label: () => ui("Date time"), code: 'm/d/yyyy h:mm', example: '9/26/2008 15:59', group: 3 },
  { id: 'duration', label: () => ui("Duration"), code: '[h]:mm:ss', example: '24:01:00', group: 3 },
  { id: 'fraction', label: () => ui("Fraction"), code: '# ?/?', example: '1000 1/8', group: 4 },
]

/** The code a choice applies in this view: a quick format follows the view's (a host's euro currency). */
export function numberFormatCode(view: Pick<SheetView, 'quickFormat'>, format: NumberFormatChoice): string {
  return format.quick ? view.quickFormat(format.quick) : format.code
}

/** The menu choice showing `code`, if one does. */
export function numberFormatChoice(view: Pick<SheetView, 'quickFormat'>, code: string): NumberFormatChoice | undefined {
  return NUMBER_FORMATS.find((format) => numberFormatCode(view, format) === code)
}
