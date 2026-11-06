import { parseXml } from '../../ooxml/package.js'
import { MAX_COLS, MAX_ROWS, parseCellName } from '../address.js'
import type { Note } from '../model/schema.js'
import type { SheetModel } from '../model/workbook.js'
import { parseFragment } from './light-xml.js'
import type { ReadContext } from './read-worksheet.js'
import { readStringItem, writeStringItem } from './strings.js'
import { children, escapeXml, serializeNode, type XmlElement } from './xml.js'

/**
 * Notes (Excel's legacy comments): text in `xl/commentsN.xml`, and the box each one pops up in as
 * a VML shape in a legacy drawing. Both are rebuilt on export; each note keeps its VML shape as
 * read (size, colors, visibility), with only its cell updated. Other VML shapes (form controls)
 * stay in the drawing.
 */

export function readNotes(sheet: SheetModel, commentsPath: string, vmlPath: string | undefined, context: ReadContext): void {
  const xml = context.pkg.text(commentsPath)
  if (xml === undefined) return
  const [root] = parseFragment(xml).filter((node) => node.name === 'comments')
  if (!root) return
  const authors = (root.children.find((node) => node.name === 'authors')?.children ?? []).map((author) => author.text)
  const list = root.children.find((node) => node.name === 'commentList')?.children ?? []
  for (const comment of list) {
    if (comment.name !== 'comment') continue
    const cell = parseCellName(comment.attrs.ref ?? '')
    if (!cell) continue
    const textNode = comment.children.find((node) => node.name === 'text')
    const item = textNode ? readStringItem(textNode, xml) : { text: '' }
    const keep: Record<string, string> = {}
    for (const [name, value] of Object.entries(comment.attrs)) if (name !== 'ref' && name !== 'authorId') keep[name] = value
    const note: Note = {
      author: authors[Number(comment.attrs.authorId)] ?? '',
      text: item.text,
      ...(item.runs ? { runs: item.runs } : {}),
      ...(Object.keys(keep).length ? { keep } : {}),
    }
    sheet.ensure(cell.row, cell.col)
    sheet.notes.set(sheet.keyAt(cell.row, cell.col), note)
  }
  // Header attributes and namespace declarations of the comments part.
  sheet.raw.set('commentsPart', commentsPath)
  sheet.raw.set('commentsRoot', xml.slice(root.start, xml.indexOf('>', root.start) + 1))
  context.regenerated.add(commentsPath)
  if (vmlPath) readVml(sheet, vmlPath, context)
}

function readVml(sheet: SheetModel, path: string, context: ReadContext): void {
  const text = context.pkg.text(path)
  if (text === undefined) return
  let document
  try {
    document = parseXml(text)
  } catch {
    // Old Excel VML is often not well-formed XML; keep the part as it is.
    return
  }
  const root = document.documentElement!
  for (const shape of children(root, 'shape')) {
    const data = children(shape, 'ClientData')[0]
    if (data?.getAttribute('ObjectType') !== 'Note') continue
    const row = Number(children(data, 'Row')[0]?.textContent)
    const col = Number(children(data, 'Column')[0]?.textContent)
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) continue
    const key = sheet.keyAt(row, col)
    const note = sheet.notes.get(key) as Note | undefined
    if (note) {
      sheet.notes.set(key, { ...note, shape: serializeNode(shape), ...(children(data, 'Visible').length ? { visible: true } : {}) })
      root.removeChild(shape)
    }
  }
  sheet.raw.set('vmlPart', path)
  sheet.raw.set('vmlXml', serializeNode(document))
  context.regenerated.add(path)
}

/** The comments part for the sheet's notes. */
export function writeComments(sheet: SheetModel): string | undefined {
  const notes: { row: number; col: number; note: Note }[] = []
  for (const [key, raw] of sheet.notes) {
    const position = sheet.position(key)
    if (position) notes.push({ ...position, note: raw as Note })
  }
  if (!notes.length) return undefined
  notes.sort((a, b) => a.row - b.row || a.col - b.col)
  const authors: string[] = []
  const authorIndex = (author: string) => {
    let index = authors.indexOf(author)
    if (index < 0) index = authors.push(author) - 1
    return index
  }
  let list = ''
  for (const { row, col, note } of notes) {
    const attrs = Object.entries(note.keep ?? {})
      .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
      .join('')
    const ref = `${columnLetters(col)}${row + 1}`
    list += `<comment ref="${ref}" authorId="${authorIndex(note.author)}"${attrs}><text>${writeStringItem({ text: note.text, ...(note.runs ? { runs: note.runs } : {}) })}</text></comment>`
  }
  const root = (sheet.raw.get('commentsRoot') as string | undefined) ?? '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  const authorsXml = `<authors>${authors.map((author) => `<author>${escapeXml(author)}</author>`).join('')}</authors>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${root}${authorsXml}<commentList>${list}</commentList></comments>`
}

function columnLetters(col: number): string {
  let name = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/** The VML drawing holding each note's box, plus any other shapes the drawing had. */
export function writeNotesVml(sheet: SheetModel): string | undefined {
  const skeleton = sheet.raw.get('vmlXml') as string | undefined
  const notes: { row: number; col: number; note: Note }[] = []
  for (const [key, raw] of sheet.notes) {
    const position = sheet.position(key)
    if (position) notes.push({ ...position, note: raw as Note })
  }
  if (!notes.length && !skeleton) return undefined
  notes.sort((a, b) => a.row - b.row || a.col - b.col)
  const document = parseXml(skeleton ?? DEFAULT_VML)
  const root = document.documentElement!
  let nextId = 1025
  for (const shape of children(root, 'shape')) {
    const id = /_s(\d+)/.exec(shape.getAttribute('id') ?? '')
    if (id) nextId = Math.max(nextId, Number(id[1]) + 1)
  }
  for (const { row, col, note } of notes) {
    const shape = parseXml(note.shape ?? defaultNoteShape(nextId++, row, col)).documentElement!
    const data = children(shape, 'ClientData')[0]
    if (data) {
      setChildText(data, 'Row', String(row))
      setChildText(data, 'Column', String(col))
      // The box sits to the right of its cell; keep the original size but move it along.
      const anchor = children(data, 'Anchor')[0]
      if (anchor && note.shape) {
        const parts = (anchor.textContent ?? '').split(',').map((part) => Number(part.trim()))
        if (parts.length === 8 && parts.every(Number.isFinite)) {
          const width = parts[4]! - parts[0]!
          const height = parts[6]! - parts[2]!
          const left = col + 1
          const top = Math.max(0, row - 1)
          anchor.textContent = [left, parts[1], top, parts[3], left + width, parts[5], top + height, parts[7]].join(', ')
        }
      }
    }
    root.appendChild(document.importNode(shape, true))
  }
  return serializeNode(document)
}

function setChildText(parent: XmlElement, name: string, value: string): void {
  const existing = children(parent, name)[0]
  if (existing) {
    existing.textContent = value
    return
  }
  const element = parent.ownerDocument!.createElementNS('urn:schemas-microsoft-com:office:excel', `x:${name}`)
  element.textContent = value
  parent.appendChild(element)
}

const DEFAULT_VML =
  '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
  '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
  '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
  '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype></xml>'

function defaultNoteShape(id: number, row: number, col: number): string {
  return (
    `<v:shape xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" id="_x0000_s${id}" type="#_x0000_t202" ` +
    'style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">' +
    '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
    '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox>' +
    `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${col + 1}, 15, ${Math.max(0, row - 1)}, 10, ${col + 3}, 15, ${row + 3}, 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${col}</x:Column></x:ClientData>` +
    '</v:shape>'
  )
}
