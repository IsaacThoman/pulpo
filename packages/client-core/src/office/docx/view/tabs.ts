import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { twipsToPt } from '../css.js'
import { jmlAttr, jmlElements, jmlNumber } from '../jsonml.js'
import { effectiveParagraphProperties } from './commands.js'
import type { DocxViewContext } from './context.js'
import { PX_PER_PT } from './layout.js'

/**
 * Tab stops. Browsers only know evenly spaced tab stops, so after layout every tab character is
 * sized to reach its stop: custom stops (left, center, right, decimal, with leaders), the hanging
 * indent's implicit stop, then the document's default stops. Positions count from the text
 * area's left edge (the cell's, inside tables), as in Word.
 */

export interface TabStop {
  /** px from the left edge of the text area. */
  pos: number
  align: 'left' | 'center' | 'right' | 'decimal' | 'bar'
  leader?: string
}

export interface ParagraphTabs {
  stops: TabStop[]
  /** The hanging indent's stop, when the first line hangs. */
  hanging?: number
  /** Default stop interval, px. */
  interval: number
}

export function paragraphTabs(node: ProseMirrorNode, context: DocxViewContext): ParagraphTabs {
  const props = effectiveParagraphProperties(node, context)
  const stops: TabStop[] = []
  for (const tab of jmlElements(props.get('w:tabs') ?? ['w:tabs', {}])) {
    const value = jmlAttr(tab, 'w:val') ?? 'left'
    if (value === 'clear' || value === 'num') continue
    const pos = jmlNumber(tab, 'w:pos')
    if (pos === undefined) continue
    const align = value === 'center' || value === 'right' || value === 'decimal' || value === 'bar' ? value : value === 'end' ? 'right' : 'left'
    const leader = jmlAttr(tab, 'w:leader')
    stops.push({ pos: twipsToPt(pos) * PX_PER_PT, align, ...(leader && leader !== 'none' ? { leader } : {}) })
  }
  stops.sort((a, b) => a.pos - b.pos)
  const ind = props.get('w:ind')
  const left = jmlNumber(ind, 'w:left') ?? jmlNumber(ind, 'w:start') ?? 0
  const hanging = jmlNumber(ind, 'w:hanging')
  return {
    stops,
    hanging: hanging ? twipsToPt(left) * PX_PER_PT : undefined,
    interval: context.defaultTabStop * PX_PER_PT,
  }
}

const DECIMAL = /[.,]/

/** Width of the text after a tab up to the next tab (or the line's end), in px. */
function segmentWidth(tab: HTMLElement, scale: number, untilDecimal: boolean): number {
  const range = tab.ownerDocument.createRange()
  range.setStartAfter(tab)
  const paragraph = tab.closest('.docx-p') ?? tab.parentElement!
  let end: Node = paragraph
  let endOffset = paragraph.childNodes.length
  const walker = tab.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  walker.currentNode = tab
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains('docx-tab')) {
      end = node
      endOffset = 0
      range.setEndBefore(node)
      break
    }
    if (untilDecimal && node.nodeType === Node.TEXT_NODE) {
      const index = (node.textContent ?? '').search(DECIMAL)
      if (index >= 0) {
        range.setEnd(node, index)
        end = node
        break
      }
    }
  }
  if (end === paragraph) range.setEnd(paragraph, endOffset)
  const tabTop = tab.getBoundingClientRect().top
  let width = 0
  for (const rect of range.getClientRects()) if (Math.abs(rect.top - tabTop) < 4 || width === 0) width += rect.width
  return width / scale
}

/**
 * Sizes the tabs of `container`'s paragraphs. Returns each tab's width and leader (by element),
 * so the editor can keep them as decorations.
 */
export function layoutTabs(container: HTMLElement, tabsOf: (paragraph: HTMLElement) => ParagraphTabs | undefined): Map<HTMLElement, { width: number; leader?: string }> {
  const results = new Map<HTMLElement, { width: number; leader?: string }>()
  const scale = container.offsetWidth ? container.getBoundingClientRect().width / container.offsetWidth : 1
  const paragraphs = new Set<HTMLElement>()
  for (const tab of container.querySelectorAll<HTMLElement>('.docx-tab')) {
    const paragraph = tab.closest<HTMLElement>('.docx-p')
    if (paragraph) paragraphs.add(paragraph)
  }
  for (const paragraph of paragraphs) {
    const tabs = tabsOf(paragraph)
    if (!tabs) continue
    const cell = paragraph.closest('td')
    const area = cell ?? container
    const areaRect = area.getBoundingClientRect()
    const padding = cell ? parseFloat(getComputedStyle(cell).paddingLeft) || 0 : 0
    const origin = areaRect.left + padding * scale
    const own = [...paragraph.querySelectorAll<HTMLElement>('.docx-tab')].filter((tab) => tab.closest('.docx-p') === paragraph)
    // Start from collapsed tabs so earlier layouts do not skew the measurements.
    for (const tab of own) tab.style.width = '0px'
    for (const tab of own) {
      const x = (tab.getBoundingClientRect().left - origin) / scale
      const paragraphLeft = (paragraph.getBoundingClientRect().left - origin) / scale
      let stop: TabStop | undefined = tabs.stops.find((candidate) => candidate.pos > x + 0.5 && candidate.align !== 'bar')
      // The hanging indent is a stop of its own for the first line.
      if (tabs.hanging !== undefined && tabs.hanging > x + 0.5 && (!stop || tabs.hanging < stop.pos)) stop = { pos: tabs.hanging, align: 'left' }
      if (!stop) {
        const base = Math.max(0, x - Math.min(0, paragraphLeft))
        stop = { pos: (Math.floor(base / tabs.interval + 1e-6) + 1) * tabs.interval, align: 'left' }
      }
      let width = stop.pos - x
      if (stop.align === 'right') width -= segmentWidth(tab, scale, false)
      else if (stop.align === 'center') width -= segmentWidth(tab, scale, false) / 2
      else if (stop.align === 'decimal') width -= segmentWidth(tab, scale, true)
      width = Math.max(1, width)
      tab.style.width = `${width}px`
      if (stop.leader) tab.dataset.leader = stop.leader
      else delete tab.dataset.leader
      results.set(tab, { width, ...(stop.leader ? { leader: stop.leader } : {}) })
    }
  }
  return results
}
