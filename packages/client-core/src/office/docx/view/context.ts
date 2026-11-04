import type * as Y from 'yjs'
import type { ThemeInfo } from '../css.js'
import { jmlAttr, jmlNumber, unpackJml, type JmlElement } from '../jsonml.js'
import { parseJson, readDocxMap, type CommentMeta } from '../model.js'
import { Numbering } from '../numbering.js'
import { StyleSheet } from '../styles.js'

/**
 * What rendering needs besides a story's own nodes: styles, numbering, theme, settings, the
 * final section, and comments. Rebuilt from the Y maps whenever one of them changes, so a style
 * edited by a collaborator restyles everyone's view.
 */
export class DocxViewContext {
  styles!: StyleSheet
  numbering!: Numbering
  theme: ThemeInfo | undefined
  /** Default tab stop in points. */
  defaultTabStop = 36
  evenAndOddHeaders = false
  trackRevisions = false
  finalSectPr: JmlElement | undefined
  comments = new Map<string, CommentMeta>()
  /** Bumped on every rebuild; plugins compare it to know when to recompute. */
  version = 0
  private readonly listeners = new Set<() => void>()
  private readonly unobserve: (() => void)[] = []

  constructor(readonly doc: Y.Doc) {
    this.rebuild()
    for (const name of ['styles', 'numbering', 'settings', 'docx', 'comments'] as const) {
      const map = doc.getMap(name)
      const observer = () => {
        this.rebuild()
        for (const listener of this.listeners) listener()
      }
      map.observe(observer)
      this.unobserve.push(() => map.unobserve(observer))
    }
  }

  private rebuild(): void {
    this.styles = new StyleSheet(readDocxMap(this.doc, 'styles'))
    this.numbering = new Numbering(readDocxMap(this.doc, 'numbering'), this.styles)
    const meta = readDocxMap(this.doc, 'docx')
    this.theme = parseJson<ThemeInfo>(meta.get('theme'))
    this.finalSectPr = unpackJml<JmlElement>(meta.get('sectPr'))
    const settings = readDocxMap(this.doc, 'settings')
    const tab = jmlNumber(unpackJml<JmlElement>(settings.get('w:defaultTabStop')), 'w:val')
    this.defaultTabStop = tab && tab > 0 ? tab / 20 : 36
    const onOff = (name: string) => {
      const element = unpackJml<JmlElement>(settings.get(name))
      if (!element) return false
      const value = jmlAttr(element, 'w:val')
      return value === undefined || !['0', 'false', 'off'].includes(value)
    }
    this.evenAndOddHeaders = onOff('w:evenAndOddHeaders')
    this.trackRevisions = onOff('w:trackRevisions')
    this.comments = new Map()
    for (const [id, json] of readDocxMap(this.doc, 'comments')) this.comments.set(id, parseJson<CommentMeta>(json) ?? {})
    this.version++
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  destroy(): void {
    for (const stop of this.unobserve) stop()
    this.listeners.clear()
  }
}
