import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { jmlAttr, jmlChild, jmlText, unpackJml, walkJml, type JmlElement } from './jsonml.js'
import { parseJson, type CommentMeta, type DocxModel } from './model.js'
import { ListCounter, Numbering, effectiveNumPr } from './numbering.js'
import { inlineMarks, symbolText } from './schema.js'
import { StyleSheet } from './styles.js'

/**
 * Plain text of a Word document, for agents (`pulpo files cat`), search, grep, and previews.
 *
 * Reads as the document shows with every tracked change accepted: list labels as Word draws
 * them, headings marked with `#` by outline level, tables as `|` rows, footnotes as `[^n]` with
 * their text at the end, and comments listed after the body with what they point at.
 */

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

/** Current row/cell revisions control the accepted view; old property snapshots do not. */
export function tablePartDeleted(node: ProseMirrorNode): boolean {
  if (node.type.name === 'tableRow') return !!jmlChild(jml(node.attrs.trPr), 'w:del')
  if (node.type.name === 'tableCell') {
    const properties = jml(node.attrs.tcPr)
    return !!(jmlChild(properties, 'w:cellDel') || jmlChild(properties, 'w:del'))
  }
  return false
}

export interface TextContext {
  styles: StyleSheet
  numbering: Numbering
  counter: ListCounter
  notes: Map<string, number>
  noteCount: { footnote: number; endnote: number }
}

export function textContext(model: Pick<DocxModel, 'maps'>): TextContext {
  const styles = new StyleSheet(model.maps.styles)
  const numbering = new Numbering(model.maps.numbering, styles)
  return { styles, numbering, counter: new ListCounter(numbering), notes: new Map(), noteCount: { footnote: 0, endnote: 0 } }
}

/** Text of math: its runs' text, which reads well enough for search and agents. */
export function mathText(element: JmlElement | undefined): string {
  if (!element) return ''
  let text = ''
  walkJml(element, (child) => {
    if (child[0] === 'm:t') {
      text += jmlText(child)
      return false
    }
    return undefined
  })
  return text
}

function drawingText(element: JmlElement | undefined): string {
  let description: string | undefined
  let boxText = ''
  if (element) walkJml(element, (child) => {
    if (child[0] === 'wp:docPr') description ??= jmlAttr(child, 'descr') || jmlAttr(child, 'title')
    if (child[0] === 'w:txbxContent') {
      boxText += jmlText(child).trim()
      return false
    }
    return undefined
  })
  if (boxText) return boxText
  return description ? `[Image: ${description}]` : '[Image]'
}

/** A paragraph's inline text; `context` numbers notes as they appear. */
export function inlineText(paragraph: ProseMirrorNode, context?: TextContext): string {
  let text = ''
  let fieldDepth = 0
  let inCode = false
  paragraph.forEach((child) => {
    const deleted = inlineMarks(child).some((mark) => mark.type.name === 'del' || mark.type.name === 'moveFrom')
    if (deleted) return
    switch (child.type.name) {
      case 'text':
        if (!inCode) text += child.text
        break
      case 'tab':
        text += '\t'
        break
      case 'break':
        text += '\n'
        break
      case 'sym': {
        const element = jml(child.attrs.v)
        text += symbolText(jmlAttr(element, 'w:font'), jmlAttr(element, 'w:char'))
        break
      }
      case 'noteRef': {
        const kind = child.attrs.kind === 'endnote' ? 'endnote' : 'footnote'
        if (jmlAttr(jml(child.attrs.v), 'w:customMarkFollows')) break
        let number = context?.notes.get(`${kind}:${child.attrs.id}`)
        if (context && number === undefined) {
          number = ++context.noteCount[kind]
          context.notes.set(`${kind}:${child.attrs.id}`, number)
        }
        text += kind === 'footnote' ? `[^${number ?? ''}]` : `[^e${number ?? ''}]`
        break
      }
      case 'fieldChar': {
        const type = child.attrs.charType
        if (type === 'begin') {
          fieldDepth++
          inCode = true
        } else if (type === 'separate') inCode = false
        else if (type === 'end') {
          fieldDepth = Math.max(0, fieldDepth - 1)
          inCode = false
        }
        break
      }
      case 'drawing':
        text += drawingText(jml(child.attrs.v))
        break
      case 'math':
        text += mathText(jml(child.attrs.v))
        break
      default:
        break
    }
  })
  return text
}

function paragraphText(node: ProseMirrorNode, context: TextContext): string {
  let prefix = ''
  const list = effectiveNumPr(jml(node.attrs.numPr), node.attrs.pStyle as string | null, context.styles)
  const label = list ? context.counter.next(list.numId, list.ilvl) : undefined
  if (label?.text) prefix = `${label.text}${label.level.suff === 'nothing' ? '' : ' '}`
  const outline = jmlAttr(jml(node.attrs.outlineLvl), 'w:val')
  const level = outline !== undefined ? Number(outline) : context.styles.outlineLevel(node.attrs.pStyle as string | null)
  if (level !== undefined && level >= 0 && level < 6) prefix = `${'#'.repeat(level + 1)} ${prefix}`
  return prefix + inlineText(node, context)
}

/** Lines of a story's blocks. */
export function blocksText(node: ProseMirrorNode, context: TextContext): string[] {
  const lines: string[] = []
  node.forEach((child) => {
    switch (child.type.name) {
      case 'paragraph':
        lines.push(paragraphText(child, context))
        break
      case 'table':
        child.forEach((row) => {
          if (tablePartDeleted(row)) return
          const cells: string[] = []
          row.forEach((cell) => {
            if (cell.attrs.phantom || tablePartDeleted(cell)) return
            cells.push(blocksText(cell, context).join(' ').replace(/\|/g, '\\|').trim())
          })
          if (cells.length) lines.push(`| ${cells.join(' | ')} |`)
        })
        break
      case 'blockWrapper':
        lines.push(...blocksText(child, context))
        break
      default:
        break
    }
  })
  return lines
}

export function docxToText(model: DocxModel): string {
  const context = textContext(model)
  const sections: string[] = [blocksText(model.body, context).join('\n')]

  const notes: string[] = []
  for (const [key, number] of [...context.notes].sort((a, b) => a[1] - b[1])) {
    const story = model.stories.get(key)
    if (!story) continue
    const text = blocksText(story.doc, context).join(' ').trim()
    notes.push(`${key.startsWith('endnote') ? `[^e${number}]` : `[^${number}]`}: ${text}`)
  }
  if (notes.length) sections.push(notes.join('\n'))

  const comments: string[] = []
  const anchors = commentAnchors(model.body)
  for (const [id, json] of model.maps.comments) {
    const meta = parseJson<CommentMeta>(json) ?? {}
    const story = model.stories.get(`comment:${id}`)
    const text = story ? blocksText(story.doc, context).join(' ').trim() : ''
    const anchor = anchors.get(id)
    const who = meta.author ? ` ${meta.author}` : ''
    const state = meta.done ? ' (resolved)' : ''
    const reply = meta.parentId ? ` reply to ${meta.parentId}` : ''
    comments.push(`[comment ${id}${reply}${who}${state}${anchor ? ` on "${anchor}"` : ''}]: ${text}`)
  }
  if (comments.length) sections.push(comments.join('\n'))
  return sections.filter(Boolean).join('\n\n') + '\n'
}

/** The text each comment covers, for listing comments with their context. */
export function commentAnchors(doc: ProseMirrorNode): Map<string, string> {
  const open = new Map<string, string>()
  const done = new Map<string, string>()
  doc.descendants((node) => {
    if (tablePartDeleted(node) || (node.type.name === 'tableCell' && node.attrs.phantom)) return false
    if (node.type.name === 'commentMark') {
      const id = String(node.attrs.id)
      if (node.attrs.edge === 'start') open.set(id, '')
      else if (node.attrs.edge === 'end' && open.has(id)) {
        done.set(id, open.get(id)!)
        open.delete(id)
      }
      return false
    }
    if (node.isText && open.size && !node.marks.some((mark) => mark.type.name === 'del')) {
      for (const [id, text] of open) if (text.length < 200) open.set(id, text + node.text)
    }
    if (node.type.name === 'paragraph' && open.size) for (const [id, text] of open) if (text) open.set(id, `${text} `)
    return true
  })
  for (const [id, text] of done) done.set(id, text.trim().replace(/\s+/g, ' ').slice(0, 120))
  return done
}
