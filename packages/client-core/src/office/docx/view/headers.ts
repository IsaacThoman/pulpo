import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type * as Y from 'yjs'
import { relativeTarget, resolveTarget, type Relationship } from '../../ooxml/package.js'
import { packJml, type JmlElement } from '../jsonml.js'
import { parseJson, readDocxMap, type StoryMeta } from '../model.js'
import { REL } from '../names.js'
import {
  editSections,
  hasTitlePage,
  sectionHolders,
  sectionIndexAt,
  sectionReference,
  withSectionReference,
  withTitlePage,
  type HeaderFooterKind,
  type HeaderFooterType,
  type MapEdit,
} from './commands.js'
import type { DocxViewContext } from './context.js'
import type { StoryResult } from './stories.js'

/**
 * Headers and footers created in the editor: a new part with its relationship and story, and a
 * reference in a section's properties. Part names and relationship ids are spread out at random,
 * so collaborators adding headers at once do not write into each other's.
 */

export function mainPartOf(doc: Y.Doc): string {
  return doc.getMap<string>('docx').get('mainPart') ?? 'word/document.xml'
}

/** The header or footer story a relationship of the main part points at. */
export function storyByRelationship(doc: Y.Doc, relId: string): string | undefined {
  const rel = parseJson<Omit<Relationship, 'id'>>(readDocxMap(doc, 'rels').get(relId))
  if (!rel || rel.targetMode === 'External') return undefined
  const kind = rel.type.endsWith('/header') ? 'header' : rel.type.endsWith('/footer') ? 'footer' : undefined
  return kind ? `${kind}:${resolveTarget(mainPartOf(doc), rel.target)}` : undefined
}

/** The header or footer a section shows for a type: its own, or the one it inherits from an earlier section, as Word links them. */
export function headerFooterOf(state: EditorState, context: DocxViewContext, kind: HeaderFooterKind, type: HeaderFooterType, section = sectionIndexAt(state.doc, state.selection.from)): { storyId: string; relId: string; section: number } | undefined {
  const holders = sectionHolders(state.doc, context.finalSectPr)
  const stories = context.doc.getMap('stories')
  for (let index = Math.min(section, holders.length - 1); index >= 0; index--) {
    const relId = sectionReference(holders[index]!.sectPr, kind, type)
    if (!relId) continue
    const storyId = storyByRelationship(context.doc, relId)
    if (storyId && stories.has(storyId)) return { storyId, relId, section: index }
  }
  return undefined
}

/** Headers, footers, and their options for a section (the cursor's, or the open header's). */
export interface HeaderFooterInfo {
  section: number
  sections: number
  header: Partial<Record<HeaderFooterType, string>>
  footer: Partial<Record<HeaderFooterType, string>>
  differentFirstPage: boolean
  differentOddEven: boolean
}

export function headerFooterInfo(state: EditorState, context: DocxViewContext, section = sectionIndexAt(state.doc, state.selection.from)): HeaderFooterInfo {
  const holders = sectionHolders(state.doc, context.finalSectPr)
  const info: HeaderFooterInfo = { section, sections: holders.length, header: {}, footer: {}, differentFirstPage: hasTitlePage(holders[section]?.sectPr), differentOddEven: context.evenAndOddHeaders }
  for (const kind of ['header', 'footer'] as const) {
    for (const type of ['default', 'first', 'even'] as const) {
      const found = headerFooterOf(state, context, kind, type, section)
      if (found) info[kind][type] = found.storyId
    }
  }
  return info
}

function spread(used: Iterable<number>): number {
  let largest = 0
  for (const value of used) largest = Math.max(largest, value)
  return largest + 1 + Math.floor(Math.random() * 2 ** 16)
}

/** A header or footer part name no part, story, or relationship of the document uses. */
function freshPart(doc: Y.Doc, kind: HeaderFooterKind): string {
  const used = new Set<string>(doc.getMap('parts').keys())
  for (const json of readDocxMap(doc, 'stories').values()) {
    const part = parseJson<StoryMeta>(json)?.part
    if (part) used.add(part)
  }
  const main = mainPartOf(doc)
  for (const json of readDocxMap(doc, 'rels').values()) {
    const rel = parseJson<Omit<Relationship, 'id'>>(json)
    if (rel && rel.targetMode !== 'External') used.add(resolveTarget(main, rel.target))
  }
  const numbers = [...used].map((path) => new RegExp(`^word/${kind}(\\d+)\\.xml$`).exec(path)?.[1]).filter((value): value is string => value !== undefined).map(Number)
  for (let attempt = 0; attempt < 16; attempt++) {
    const part = `word/${kind}${spread(numbers)}.xml`
    if (!used.has(part)) return part
  }
  return `word/${kind}${Date.now().toString(36)}.xml`
}

function freshRelationship(doc: Y.Doc): string {
  const used = new Set(doc.getMap('rels').keys())
  const numbers = [...used].map((id) => /^rId(\d+)$/.exec(id)?.[1]).filter((value): value is string => value !== undefined).map(Number)
  for (let attempt = 0; attempt < 16; attempt++) {
    const id = `rId${spread(numbers)}`
    if (!used.has(id)) return id
  }
  return `rIdPulpo${Date.now().toString(36)}`
}

/** The paragraph style Word gives a new header or footer. */
function storyStyle(context: DocxViewContext, kind: HeaderFooterKind): string | null {
  const style = context.styles.get(kind === 'header' ? 'Header' : 'Footer') ?? context.styles.findByName(kind)
  return style?.type === 'paragraph' ? style.id : null
}

export function headerFooterParagraph(schema: Schema, context: DocxViewContext, kind: HeaderFooterKind, attrs: Record<string, unknown> = {}, content?: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node('paragraph', { pStyle: storyStyle(context, kind), ...attrs }, content)
}

/**
 * A new, empty header or footer for a section (by default the cursor's). It is referenced from
 * the first section, so every section inherits it unless it has its own (Word's "Link to
 * Previous"); a first-page one also turns on that section's different first page, and an
 * even-page one the document's different odd and even pages. Editing only: section properties
 * have no tracked form.
 */
export function createHeaderFooter(state: EditorState, context: DocxViewContext, kind: HeaderFooterKind, type: HeaderFooterType, section = sectionIndexAt(state.doc, state.selection.from)): (StoryResult & { storyId: string }) | null {
  const doc = context.doc
  const part = freshPart(doc, kind)
  const relId = freshRelationship(doc)
  const storyId = `${kind}:${part}`
  const sections = editSections(state, context, [0, section], (sectPr, index) => {
    let next = sectPr
    if (index === 0) next = withSectionReference(next, kind, type, relId)
    if (index === section && type === 'first') next = withTitlePage(next, true)
    return next
  })
  if (!sections) return null
  const maps: MapEdit[] = [['rels', relId, JSON.stringify({ type: REL[kind], target: relativeTarget(mainPartOf(doc), part) })], ...(sections.maps ?? [])]
  if (type === 'even' && !context.evenAndOddHeaders) maps.push(['settings', 'w:evenAndOddHeaders', packJml(['w:evenAndOddHeaders', {}])])
  const story = state.schema.node('doc', null, [headerFooterParagraph(state.schema, context, kind)])
  return { tr: sections.tr, maps, stories: [{ id: storyId, meta: { kind, part }, doc: story }], storyId }
}

/** The relationships of the main part that point at a header or footer story. */
function relationshipsOf(doc: Y.Doc, storyId: string): string[] {
  return [...doc.getMap('rels').keys()].filter((id) => storyByRelationship(doc, id) === storyId)
}

/**
 * Whether a header or footer is still in the document: its story exists and some section
 * references it (for any page type). A collaborator removing it, or writing the same section's
 * properties while it was being created (last writer wins), leaves it unreferenced.
 */
export function headerFooterReferenced(state: EditorState, context: DocxViewContext, storyId: string): boolean {
  if (!context.doc.getMap('stories').has(storyId)) return false
  const relIds = relationshipsOf(context.doc, storyId)
  if (!relIds.length) return false
  const kind = storyId.startsWith('header:') ? 'header' : 'footer'
  const refers = (sectPr: JmlElement | undefined) => (['default', 'first', 'even'] as const).some((type) => {
    const relId = sectionReference(sectPr, kind, type)
    return relId !== undefined && relIds.includes(relId)
  })
  // The final section first: it holds most documents' references, without a walk of the body.
  return refers(context.finalSectPr) || sectionHolders(state.doc, context.finalSectPr).some((holder) => refers(holder.sectPr))
}

/**
 * Takes a header or footer away from the sections that show it (every reference to its
 * relationship), with its story and relationship.
 */
export function removeHeaderFooter(state: EditorState, context: DocxViewContext, storyId: string): StoryResult | null {
  const doc = context.doc
  const relIds = relationshipsOf(doc, storyId)
  if (!relIds.length) return null
  const kind = storyId.startsWith('header:') ? 'header' : 'footer'
  const sections = editSections(state, context, 'all', (sectPr) => {
    let next = sectPr
    for (const type of ['default', 'first', 'even'] as const) {
      const relId = sectionReference(next, kind, type)
      if (relId && relIds.includes(relId)) next = withSectionReference(next, kind, type, null)
    }
    return next
  })
  return {
    tr: sections?.tr ?? null,
    maps: [...relIds.map((id): MapEdit => ['rels', id, null]), ...(sections?.maps ?? [])],
    stories: [{ id: storyId, meta: null }],
  }
}
