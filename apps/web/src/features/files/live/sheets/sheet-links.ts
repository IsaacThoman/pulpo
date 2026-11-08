import { parseRangeName, quoteSheetName, type Hyperlink, type WorkbookModel } from '@pulpo/client-core/office/sheets'

/** What the link dialog's `accept` returns for a place in the workbook, so `onApply` can tell it from a web link. */
const LOCATION_PREFIX = '#'

/**
 * A link typed as a place in this workbook, as Excel's "Place in This Document" and Google's
 * "Sheets and named ranges" take them: `A1`, `B2:C9`, `Sheet2!A1`, `'Q1 plan'!A1`, `#Sheet2!A1`, or
 * a defined name. Returns the location to store (sheet names as the workbook spells them), or
 * undefined when the text isn't one, so the dialog's web rules apply.
 */
export function workbookLocation(workbook: Pick<WorkbookModel, 'sheetByName' | 'names'>, input: string): string | undefined {
  const text = input.trim().replace(/^#/, '').trim()
  if (!text || /\s/.test(text.replace(/^'[^']*(?:''[^']*)*'!/, ''))) return undefined
  const bang = text.lastIndexOf('!')
  if (bang > 0) {
    const sheetName = text.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'")
    const sheet = workbook.sheetByName(sheetName)
    const reference = text.slice(bang + 1).replace(/\$/g, '')
    if (!sheet || !parseRangeName(reference)) return undefined
    return `${quoteSheetName(sheet.name)}!${reference.toUpperCase()}`
  }
  if (parseRangeName(text.replace(/\$/g, ''))) return text.replace(/\$/g, '').toUpperCase()
  const name = [...workbook.names.values()].find((entry) => entry.name.toLowerCase() === text.toLowerCase())
  return name?.name
}

/** The dialog's `accept` for a sheet: workbook places, marked so `linkFromDialog` stores them as locations. */
export function acceptWorkbookLocation(workbook: Pick<WorkbookModel, 'sheetByName' | 'names'>) {
  return (value: string) => {
    const location = workbookLocation(workbook, value)
    return location === undefined ? undefined : `${LOCATION_PREFIX}${location}`
  }
}

/** The link the dialog's value stores: a place in the workbook, or a web address. */
export function linkFromDialog(url: string, text: string): Hyperlink {
  const display = text.trim() ? { display: text.trim() } : {}
  return url.startsWith(LOCATION_PREFIX) ? { location: url.slice(LOCATION_PREFIX.length), ...display } : { target: url, ...display }
}

/** What the dialog shows for an existing link. */
export function linkDialogUrl(link: Hyperlink | undefined): string {
  return link?.target ?? link?.location ?? ''
}
