import { attr, child, childElements, intAttr, NS, parseFragment, type XmlElement } from '../xml.js'
import { resolveColor, toCss } from './color.js'
import { emuToPx, px, type RenderEnv } from './env.js'
import { fillElementOf, paintFill, styleReference, themeFill } from './fill.js'
import { emptyBag, type PropertyBag } from './props.js'
import { builtInTableStyle } from './table-styles.js'
import { bodyLayout, renderParagraphs, type TextStyleContext } from './text.js'

/**
 * Tables (`a:tbl`) as HTML tables: column widths from the grid, rows at least their stored
 * height (PowerPoint grows rows to fit text, as CSS tables do), and borders, fills, and text
 * formatting from cell properties over the table style's parts.
 */

const builtInCache = new Map<string, XmlElement | undefined>()

function builtInStyle(styleId: string): XmlElement | undefined {
  if (builtInCache.has(styleId)) return builtInCache.get(styleId)
  const xml = builtInTableStyle(styleId)
  const style = xml ? parseFragment(xml) : undefined
  builtInCache.set(styleId, style)
  return style
}

interface CellPosition {
  row: number
  column: number
  rows: number
  columns: number
}

/** The table style parts that apply to a cell, least specific first. */
function styleParts(style: XmlElement | undefined, flags: Record<string, boolean>, position: CellPosition): XmlElement[] {
  if (!style) return []
  const part = (name: string) => child(style, name, NS.a)
  const parts: (XmlElement | undefined)[] = [part('wholeTbl')]
  const firstBodyRow = flags.firstRow ? 1 : 0
  if (flags.bandRow && position.row >= firstBodyRow && !(flags.lastRow && position.row === position.rows - 1)) {
    parts.push(part((position.row - firstBodyRow) % 2 === 0 ? 'band1H' : 'band2H'))
  }
  const firstBodyColumn = flags.firstCol ? 1 : 0
  if (flags.bandCol && position.column >= firstBodyColumn) parts.push(part((position.column - firstBodyColumn) % 2 === 0 ? 'band1V' : 'band2V'))
  if (flags.lastCol && position.column === position.columns - 1) parts.push(part('lastCol'))
  if (flags.firstCol && position.column === 0) parts.push(part('firstCol'))
  if (flags.lastRow && position.row === position.rows - 1) parts.push(part('lastRow'))
  if (flags.firstRow && position.row === 0) parts.push(part('firstRow'))
  if (flags.firstRow && flags.firstCol && position.row === 0 && position.column === 0) parts.push(part('nwCell'))
  if (flags.firstRow && flags.lastCol && position.row === 0 && position.column === position.columns - 1) parts.push(part('neCell'))
  if (flags.lastRow && flags.firstCol && position.row === position.rows - 1 && position.column === 0) parts.push(part('swCell'))
  if (flags.lastRow && flags.lastCol && position.row === position.rows - 1 && position.column === position.columns - 1) parts.push(part('seCell'))
  return parts.filter((entry): entry is XmlElement => entry !== undefined)
}

function lineCss(line: XmlElement | undefined, env: RenderEnv): string | undefined {
  if (!line) return undefined
  const fill = fillElementOf(line)
  if (!fill || fill.localName === 'noFill') return 'none'
  const color = resolveColor(fill.localName === 'solidFill' ? fill : child(fill, 'fgClr', NS.a) ?? childElements(child(fill, 'gsLst', NS.a))[0], env.colors)
  if (!color) return undefined
  const width = Math.max(emuToPx(intAttr(line, 'w') ?? 12700), 0.75)
  const dash = attr(child(line, 'prstDash', NS.a), 'val')
  const style = dash && dash !== 'solid' ? (dash.toLowerCase().includes('dot') && !dash.toLowerCase().includes('dash') ? 'dotted' : 'dashed') : attr(line, 'cmpd') === 'dbl' ? 'double' : 'solid'
  return `${px(width)} ${style} ${toCss(color)}`
}

/** A style border (`a:ln` or `a:lnRef`) as CSS. */
function styleBorder(side: XmlElement | undefined, env: RenderEnv): string | undefined {
  if (!side) return undefined
  const line = child(side, 'ln', NS.a)
  if (line) return lineCss(line, env)
  const reference = styleReference(child(side, 'lnRef', NS.a), (index) => env.theme.lineStyles[index - 1], env)
  return reference ? lineCss(reference.element, { ...env, colors: reference.colors }) : undefined
}

function styleFill(tcStyle: XmlElement | undefined, env: RenderEnv): string | undefined {
  const fill = child(tcStyle, 'fill', NS.a)
  const direct = fillElementOf(fill)
  if (direct) {
    const paint = paintFill(direct, env, { w: 1, h: 1 })
    return paint.value === 'none' ? 'transparent' : paint.color ? toCss(paint.color) : paint.value.startsWith('url') ? undefined : paint.value
  }
  const reference = styleReference(child(tcStyle, 'fillRef', NS.a), (index) => themeFill(env.theme, index), env)
  if (!reference) return undefined
  const paint = paintFill(reference.element, env, { w: 1, h: 1 }, reference.colors)
  return paint.color ? toCss(paint.color) : undefined
}

export interface TableBox {
  w: number
  h: number
  scaleX: number
  scaleY: number
}

export function renderTable(table: XmlElement, env: RenderEnv, box: TableBox): string {
  const tblPr = child(table, 'tblPr', NS.a)
  const flags: Record<string, boolean> = {}
  for (const name of ['firstRow', 'firstCol', 'lastRow', 'lastCol', 'bandRow', 'bandCol']) flags[name] = attr(tblPr, name) === '1' || attr(tblPr, name) === 'true'
  const styleId = child(tblPr, 'tableStyleId', NS.a)?.textContent?.trim()
  const style = child(tblPr, 'tblStyle', NS.a) ?? env.deck.tableStyle(styleId) ?? (styleId ? builtInStyle(styleId) : undefined)
  const columns = childElements(child(table, 'tblGrid', NS.a)).map((column) => emuToPx((intAttr(column, 'w') ?? 0) * box.scaleX))
  const rows = childElements(table).filter((element) => element.localName === 'tr')
  const tableFill = fillElementOf(tblPr)
  const tableBackground = tableFill ? paintFill(tableFill, env, { w: box.w, h: box.h }) : undefined
  const body = rows
    .map((row, rowIndex) => {
      const height = emuToPx((intAttr(row, 'h') ?? 0) * box.scaleY)
      const cells = childElements(row)
        .filter((element) => element.localName === 'tc')
        .map((cell, columnIndex) => {
          if (attr(cell, 'hMerge') === '1' || attr(cell, 'vMerge') === '1') return ''
          return renderCell(cell, env, style, flags, { row: rowIndex, column: columnIndex, rows: rows.length, columns: columns.length })
        })
        .join('')
      return `<tr style="height:${px(height)}">${cells}</tr>`
    })
    .join('')
  const colgroup = columns.map((width) => `<col style="width:${px(width)}"/>`).join('')
  const background = tableBackground?.color ? `background:${toCss(tableBackground.color)};` : ''
  return `<table class="pp-table" style="${background}position:absolute;left:0;top:0;width:${px(columns.reduce((sum, width) => sum + width, 0))};border-collapse:collapse;table-layout:fixed"><colgroup>${colgroup}</colgroup><tbody>${body}</tbody></table>`
}

function renderCell(cell: XmlElement, env: RenderEnv, style: XmlElement | undefined, flags: Record<string, boolean>, position: CellPosition): string {
  const parts = styleParts(style, flags, position)
  const tcPr = child(cell, 'tcPr', NS.a)
  const borders: Record<string, string | undefined> = {}
  let background: string | undefined
  const run: PropertyBag = emptyBag()
  for (const part of parts) {
    const tcStyle = child(part, 'tcStyle', NS.a)
    const tcBdr = child(tcStyle, 'tcBdr', NS.a)
    const side = (name: string) => styleBorder(child(tcBdr, name, NS.a), env)
    const assign = (key: string, value: string | undefined) => {
      if (value !== undefined) borders[key] = value
    }
    assign('left', position.column === 0 ? side('left') : side('insideV'))
    assign('right', position.column === position.columns - 1 ? side('right') : side('insideV'))
    assign('top', position.row === 0 ? side('top') : side('insideH'))
    assign('bottom', position.row === position.rows - 1 ? side('bottom') : side('insideH'))
    // A part's own outer edges also apply to its cells (a header row's bottom rule).
    if (part.localName !== 'wholeTbl') {
      for (const name of ['left', 'right', 'top', 'bottom']) assign(name, side(name))
    }
    background = styleFill(tcStyle, env) ?? background
    const text = child(part, 'tcTxStyle', NS.a)
    if (text) {
      if (attr(text, 'b')) run.attrs.b = attr(text, 'b') === 'on' ? '1' : '0'
      if (attr(text, 'i')) run.attrs.i = attr(text, 'i') === 'on' ? '1' : '0'
      const color = childElements(text).find((entry) => ['schemeClr', 'srgbClr', 'prstClr', 'sysClr', 'hslClr', 'scrgbClr'].includes(entry.localName ?? ''))
      if (color) {
        const fill = cell.ownerDocument!.createElementNS(NS.a, 'a:solidFill')
        fill.appendChild(color.cloneNode(true))
        run.children.fill = fill
      }
      const fontReference = child(text, 'fontRef', NS.a)
      const font = attr(fontReference, 'idx')
      if (font === 'major' || font === 'minor') {
        const latin = cell.ownerDocument!.createElementNS(NS.a, 'a:latin')
        latin.setAttribute('typeface', font === 'major' ? '+mj-lt' : '+mn-lt')
        run.children.latin = latin
      }
    }
  }
  const ownBorder = (name: string) => lineCss(child(tcPr, name, NS.a), env)
  for (const [key, name] of [
    ['left', 'lnL'],
    ['right', 'lnR'],
    ['top', 'lnT'],
    ['bottom', 'lnB'],
  ] as const) {
    const own = ownBorder(name)
    if (own !== undefined) borders[key] = own
  }
  const ownFill = fillElementOf(tcPr)
  if (ownFill) {
    const paint = paintFill(ownFill, env, { w: 1, h: 1 })
    background = paint.value === 'none' ? 'transparent' : paint.color ? toCss(paint.color) : background
  }
  const inset = (name: string, fallback: number) => px(emuToPx(intAttr(tcPr, name) ?? fallback))
  const anchor = attr(tcPr, 'anchor') ?? 't'
  const styles = [
    `padding:${inset('marT', 45720)} ${inset('marR', 91440)} ${inset('marB', 45720)} ${inset('marL', 91440)}`,
    `vertical-align:${anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top'}`,
    'overflow:hidden',
    'white-space:pre-wrap',
    'overflow-wrap:break-word',
  ]
  if (background) styles.push(`background:${background}`)
  for (const side of ['left', 'right', 'top', 'bottom']) styles.push(`border-${side}:${borders[side] ?? 'none'}`)
  const txBody = child(cell, 'txBody', NS.a)
  const context: TextStyleContext = { chain: [env.deck.defaultTextStyle()], baseRun: run, own: child(txBody, 'lstStyle', NS.a), theme: env.theme, colors: env.colors }
  const layout = bodyLayout([child(txBody, 'bodyPr', NS.a)])
  const paragraphs = childElements(txBody).filter((element) => element.localName === 'p')
  const content = renderParagraphs(paragraphs, { txBody, context, body: layout, rect: { x: 0, y: 0, w: 0, h: 0 }, env })
  const span = (name: string, html: string) => {
    const value = intAttr(cell, name)
    return value && value > 1 ? ` ${html}="${Math.min(value, 1000)}"` : ''
  }
  // Vertical cell text turns the text block: `vert` reads top to bottom, `vert270` bottom to top.
  const vertical = attr(tcPr, 'vert')
  const turn = vertical === 'vert' || vertical === 'eaVert' ? ';writing-mode:vertical-rl' : vertical === 'vert270' ? ';writing-mode:vertical-rl;transform:rotate(180deg)' : ''
  return `<td data-row="${position.row}" data-col="${position.column}"${span('gridSpan', 'colspan')}${span('rowSpan', 'rowspan')} style="${styles.join(';')}"><div style="--pp-fs:1${turn}">${content}</div></td>`
}

