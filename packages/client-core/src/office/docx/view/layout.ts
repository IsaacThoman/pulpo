import { twipsToPt } from '../css.js'
import { jmlAttr, jmlChild, jmlNumber, type JmlElement } from '../jsonml.js'

/**
 * Pagination as a pure function: the editor measures content as one continuous column, turns it
 * into layout units (lines of paragraphs, table rows, other blocks) with their natural heights,
 * and this decides where pages break, Word's rules included (widow and orphan control, keep with
 * next, keep lines together, page breaks, section breaks, and room for footnotes). The editor
 * then inserts spacers at the breaks and draws page sheets behind the column.
 *
 * All lengths are CSS pixels of the unzoomed column.
 */

export const PX_PER_PT = 96 / 72

export interface PageSetup {
  /** Page size and margins in px. */
  width: number
  height: number
  top: number
  bottom: number
  left: number
  right: number
  header: number
  footer: number
  titlePage: boolean
  /** `w:type` of the section: how it starts. */
  start: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' | 'nextColumn'
  /** `w:pgNumType`: restart value and format. */
  numberStart?: number
  numberFormat?: string
  columns: number
}

export function pageSetup(sectPr: JmlElement | undefined): PageSetup {
  const pgSz = jmlChild(sectPr, 'w:pgSz')
  const pgMar = jmlChild(sectPr, 'w:pgMar')
  const px = (twips: number | undefined, fallback: number) => twipsToPt(twips ?? fallback) * PX_PER_PT
  const type = jmlAttr(jmlChild(sectPr, 'w:type'), 'w:val')
  const pgNumType = jmlChild(sectPr, 'w:pgNumType')
  const width = px(jmlNumber(pgSz, 'w:w'), 12240)
  const height = px(jmlNumber(pgSz, 'w:h'), 15840)
  const titlePg = jmlChild(sectPr, 'w:titlePg')
  // Negative top/bottom margins mean "at least this, text may not move them"; Word uses their size.
  return {
    width: Math.max(72, width),
    height: Math.max(72, height),
    top: Math.abs(px(jmlNumber(pgMar, 'w:top'), 1440)),
    bottom: Math.abs(px(jmlNumber(pgMar, 'w:bottom'), 1440)),
    left: px(jmlNumber(pgMar, 'w:left'), 1440) + px(jmlNumber(pgMar, 'w:gutter'), 0),
    right: px(jmlNumber(pgMar, 'w:right'), 1440),
    header: px(jmlNumber(pgMar, 'w:header'), 720),
    footer: px(jmlNumber(pgMar, 'w:footer'), 720),
    titlePage: titlePg !== undefined && jmlAttr(titlePg, 'w:val') !== '0' && jmlAttr(titlePg, 'w:val') !== 'false',
    start: (['continuous', 'evenPage', 'oddPage', 'nextColumn'].includes(type ?? '') ? type : 'nextPage') as PageSetup['start'],
    numberStart: jmlNumber(pgNumType, 'w:start'),
    numberFormat: jmlAttr(pgNumType, 'w:fmt'),
    columns: Math.max(1, jmlNumber(jmlChild(sectPr, 'w:cols'), 'w:num') ?? 1),
  }
}

export interface LayoutUnit {
  /** Natural position in the continuous column. */
  top: number
  bottom: number
  /** The block (paragraph, table, …) the unit belongs to, by index in reading order. */
  block: number
  kind: 'line' | 'row' | 'block'
  /** Index of this line in its paragraph, and how many it has. */
  line?: number
  lines?: number
  /** Paragraph rules. */
  keepNext?: boolean
  keepLines?: boolean
  widowControl?: boolean
  /** A page break (or a page-starting section) comes before this unit. */
  breakBefore?: boolean
  /** The section this unit is in. */
  section: number
  /** Notes referenced in this unit, to be placed on its page. */
  notes?: string[]
  /** All note references, for page-based numbering without reserving space for endnotes. */
  references?: string[]
  /** Height a row break must add for repeated header rows. */
  repeatHeader?: number
}

export interface LayoutPage {
  index: number
  section: number
  setup: PageSetup
  /** Top of the page's text area in laid-out column coordinates. */
  contentTop: number
  /** Notes at the foot of this page, in order. */
  notes: string[]
  /** Height reserved for them. */
  notesHeight: number
  /** First page of its section (for title page headers). */
  firstOfSection: boolean
  /** Displayed page number. */
  number: number
}

export interface LayoutBreak {
  /** Index of the unit the break comes before. */
  unit: number
  /** Space to insert before it. */
  height: number
  /** The page the unit starts. */
  page: number
  /** Unused text area left above the break on the page before, which a moved row masks. */
  stub: number
}

export interface LayoutResult {
  pages: LayoutPage[]
  breaks: LayoutBreak[]
  /** Laid-out height of the column. */
  height: number
}

export interface LayoutOptions {
  sections: PageSetup[]
  /** Height of each note when placed, and of the separator above the first one. */
  noteHeight?: (id: string) => number
  noteSeparator?: number
}

function contentHeight(setup: PageSetup): number {
  return Math.max(24, setup.height - setup.top - setup.bottom)
}

/**
 * Where a break before `index` should really go: earlier to keep lines together, avoid widows
 * and orphans, or keep a paragraph with the next one. Never before `pageStart` (the first unit
 * on the current page), so every page holds something.
 */
function breakPoint(units: LayoutUnit[], index: number, pageStart: number): number {
  let target = index
  const unit = units[target]!
  if (unit.kind === 'line' && unit.line !== undefined && unit.lines !== undefined) {
    const first = target - unit.line
    if (unit.keepLines) target = first
    else if (unit.widowControl !== false) {
      // An orphan: one line alone at the foot of the page.
      if (unit.line === 1) target = first
      // A widow: the last line alone at the top of the next page.
      else if (unit.line === unit.lines - 1 && unit.lines > 2) target -= 1
    }
  }
  // Keep with next: pull preceding keep-with-next paragraphs along.
  for (;;) {
    const first = units[target]!
    const isBlockStart = first.kind !== 'line' || first.line === 0
    if (!isBlockStart || target === 0) break
    const previous = units[target - 1]!
    if (!previous.keepNext || previous.block === first.block) break
    const previousStart = previous.kind === 'line' && previous.line !== undefined ? target - 1 - previous.line : target - 1
    // Long paragraphs only bring their last two lines.
    const start = previous.kind === 'line' && (previous.lines ?? 1) > 3 ? target - 2 : previousStart
    if (start <= pageStart) break
    target = start
  }
  return target > pageStart ? target : index > pageStart ? index : pageStart
}

export function layoutPages(units: LayoutUnit[], options: LayoutOptions): LayoutResult {
  const setupFor = (section: number) => options.sections[Math.min(section, options.sections.length - 1)] ?? pageSetup(undefined)
  const noteHeight = options.noteHeight ?? (() => 0)
  const separator = options.noteSeparator ?? 12
  const pages: LayoutPage[] = []
  const breaks: LayoutBreak[] = []
  let shift = 0
  let section = units[0]?.section ?? 0
  let pageNumber = setupFor(section).numberStart ?? 1
  const newPage = (contentTop: number, sectionIndex: number, firstOfSection: boolean, number: number) => {
    const page: LayoutPage = { index: pages.length, section: sectionIndex, setup: setupFor(sectionIndex), contentTop, notes: [], notesHeight: 0, firstOfSection, number }
    pages.push(page)
    return page
  }
  let page = newPage(0, section, true, pageNumber)
  let pageStart = 0
  const placedNotes = new Set<string>()
  const bottomOf = (target: LayoutPage) => target.contentTop + contentHeight(target.setup) - target.notesHeight
  const gapAfter = (target: LayoutPage, next: PageSetup) => target.setup.bottom + PAGE_GAP + next.top

  let index = 0
  let guard = 0
  while (index < units.length) {
    if (++guard > units.length * 8 + 1000) break
    const unit = units[index]!
    // A new section that starts a page changes the page setup from the next page on.
    const sectionChange = unit.section !== section
    const setup = setupFor(unit.section)
    const forced = index > pageStart && (unit.breakBefore || (sectionChange && setup.start !== 'continuous'))
    const bottom = unit.bottom + shift
    const notes = (unit.notes ?? []).filter((id) => !placedNotes.has(id))
    const notesExtra = notes.reduce((sum, id) => sum + noteHeight(id), 0) + (notes.length && !page.notes.length ? separator : 0)
    const overflows = bottom > bottomOf(page) - notesExtra + 0.5
    if (forced || (overflows && index > pageStart)) {
      const at = forced ? index : breakPoint(units, index, pageStart)
      const stub = Math.max(0, page.contentTop + contentHeight(page.setup) - (units[at]!.top + shift))
      const nextSection = units[at]!.section
      const nextSetup = setupFor(nextSection)
      const startsSection = nextSection !== page.section
      let nextNumber = startsSection && nextSetup.numberStart !== undefined ? nextSetup.numberStart : page.number + 1
      let contentTop = page.contentTop + contentHeight(page.setup) + gapAfter(page, nextSetup)
      // Odd and even section starts may need a blank page in between.
      if (startsSection && ((nextSetup.start === 'oddPage' && nextNumber % 2 === 0) || (nextSetup.start === 'evenPage' && nextNumber % 2 === 1))) {
        const blank = newPage(contentTop, nextSection, false, nextNumber)
        contentTop = blank.contentTop + contentHeight(blank.setup) + gapAfter(blank, nextSetup)
        nextNumber++
      }
      const unitTop = units[at]!.top + shift
      const height = Math.max(0, contentTop - unitTop) + (units[at]!.kind === 'row' ? (units[at]!.repeatHeader ?? 0) : 0)
      shift += height
      page = newPage(contentTop, nextSection, startsSection, nextNumber)
      breaks.push({ unit: at, height, page: page.index, stub })
      section = nextSection
      pageStart = at
      // Notes of units moved to the new page are placed again from there.
      for (let moved = at; moved < index; moved++) for (const id of units[moved]!.notes ?? []) placedNotes.delete(id)
      for (const previous of pages.slice(0, -1)) previous.notes = previous.notes.filter((id) => placedNotes.has(id))
      for (const previous of pages.slice(0, -1)) previous.notesHeight = previous.notes.reduce((sum, id) => sum + noteHeight(id), 0) + (previous.notes.length ? separator : 0)
      index = at
      continue
    }
    if (sectionChange) section = unit.section
    for (const id of notes) {
      placedNotes.add(id)
      page.notes.push(id)
    }
    if (notes.length) page.notesHeight = page.notes.reduce((sum, id) => sum + noteHeight(id), 0) + separator
    // A unit taller than the page overflows it; the next unit starts the next page.
    index++
  }
  const last = units[units.length - 1]
  return { pages, breaks, height: last ? last.bottom + shift : 0 }
}

/** Gap between page sheets on screen, in px. */
export const PAGE_GAP = 16
