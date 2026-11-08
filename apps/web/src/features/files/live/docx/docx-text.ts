import { effectiveNumPr, inlineText, readDocxModel, revisionModel, textContext, unpackJml, type JmlElement } from '@pulpo/client-core/office/docx'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type * as Y from 'yjs'

/** Bullets in symbol fonts (Wingdings, Symbol) use private code points; plain text shows a bullet. */
const SYMBOL_FONT = /[\uf000-\uf0ff]/g

type TextContext = ReturnType<typeof textContext>

function paragraphLine(paragraph: ProseMirrorNode, context: TextContext): string {
  const numPr = typeof paragraph.attrs.numPr === 'string' ? unpackJml<JmlElement>(paragraph.attrs.numPr) : undefined
  const list = effectiveNumPr(numPr, paragraph.attrs.pStyle as string | null, context.styles)
  const label = list ? context.counter.next(list.numId, list.ilvl) : undefined
  const prefix = label?.text ? `${'\t'.repeat(list!.ilvl)}${label.text.replace(SYMBOL_FONT, '•')}${label.level.suff === 'nothing' ? '' : '\t'}` : ''
  return prefix + inlineText(paragraph, context)
}

function blockLines(node: ProseMirrorNode, context: TextContext, lines: string[]): void {
  node.forEach((child) => {
    switch (child.type.name) {
      case 'paragraph':
        lines.push(paragraphLine(child, context))
        break
      case 'table':
        child.forEach((row) => {
          const cells: string[] = []
          row.forEach((cell) => {
            if (cell.attrs.phantom) return
            const inner: string[] = []
            blockLines(cell, context, inner)
            cells.push(inner.join(' ').trim())
          })
          if (cells.length) lines.push(cells.join('\t'))
        })
        break
      case 'blockWrapper':
        blockLines(child, context, lines)
        break
      default:
        break
    }
  })
}

/**
 * The document as Word's and Docs' "Plain text (.txt)" download writes it: the body with tracked
 * changes accepted, list numbers and bullets as text, and table rows as tab-separated cells.
 */
export function docxPlainText(doc: Y.Doc): string {
  const model = revisionModel(readDocxModel(doc), 'accept')
  const context = textContext(model)
  const lines: string[] = []
  blockLines(model.body, context, lines)
  return `${lines.join('\n')}\n`
}

/** "Report.docx" → "Report.txt". */
export function plainTextName(name: string | undefined): string {
  const base = (name ?? '').replace(/\.(docx|docm|dotx|doc)$/i, '').trim()
  return `${base || 'Document'}.txt`
}
