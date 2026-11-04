import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { packJml } from '../jsonml.js'
import { parseJson, type CommentMeta, type StoryMeta } from '../model.js'
import { packMarks } from '../schema.js'
import { ListCounter } from '../numbering.js'
import { blocksText } from '../text.js'
import type { DocxViewContext } from './context.js'
import type { MapEdit } from './commands.js'
import { revisionDate } from './track-changes.js'

/**
 * Comments and notes: each lives in its own story fragment, with markers in the body that point
 * at it (comment ranges and references, note references) and an entry in a Y map. New ones get
 * string ids (`n…`) that the exporter numbers.
 */

export interface StoryEdit {
  id: string
  meta: StoryMeta | null
  doc?: ProseMirrorNode
}

export interface StoryResult {
  tr: Transaction | null
  maps: MapEdit[]
  stories: StoryEdit[]
}

export function newStoryId(): string {
  return `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

function styleMarks(schema: Schema, context: DocxViewContext, styleId: string) {
  return context.styles.get(styleId) ? [schema.marks.rStyle!.create({ v: packJml(['w:rStyle', { 'w:val': styleId }]) })] : []
}

/** A comment's or note's body: paragraphs of plain text in `styleId`, led by `lead`. */
function storyDoc(schema: Schema, context: DocxViewContext, styleId: string, text: string, lead?: ProseMirrorNode): ProseMirrorNode {
  const paragraphs = text.split(/\r?\n/).map((line, index) => {
    const content: ProseMirrorNode[] = []
    if (index === 0 && lead) content.push(lead)
    if (line) content.push(schema.text(line))
    return schema.node('paragraph', { pStyle: context.styles.get(styleId) ? styleId : null }, content)
  })
  return schema.node('doc', null, paragraphs)
}

export function commentStoryDoc(schema: Schema, context: DocxViewContext, text: string): ProseMirrorNode {
  const annotation = schema.node('inlineXml', { v: packJml(['w:annotationRef', {}]), inRun: true, marks: packMarks(styleMarks(schema, context, 'CommentReference')) })
  return storyDoc(schema, context, 'CommentText', text, annotation)
}

export interface CommentAuthor {
  name: string
  initials?: string
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]!.toUpperCase()).join('').slice(0, 4)
}

/** Adds a comment on the selection (or the word at a cursor). */
export function addComment(state: EditorState, context: DocxViewContext, author: CommentAuthor, text: string): StoryResult & { id: string } {
  const { schema } = state
  const id = newStoryId()
  const tr = state.tr
  let { from, to } = state.selection
  if (from === to) {
    // Word comments the word at the cursor.
    const $pos = state.doc.resolve(from)
    const parent = $pos.parent
    const offset = $pos.parentOffset
    const textContent = parent.textBetween(0, parent.content.size, undefined, '￼')
    let start = offset
    let end = offset
    while (start > 0 && /[\p{L}\p{N}_'-]/u.test(textContent[start - 1]!)) start--
    while (end < textContent.length && /[\p{L}\p{N}_'-]/u.test(textContent[end]!)) end++
    from = $pos.start() + start
    to = $pos.start() + end
  }
  const reference = schema.node('commentMark', { edge: 'ref', id, v: packJml(['w:commentReference', { 'w:id': id }]), marks: packMarks(styleMarks(schema, context, 'CommentReference')) })
  tr.insert(to, [schema.node('commentMark', { edge: 'end', id, v: packJml(['w:commentRangeEnd', { 'w:id': id }]) }), reference])
  tr.insert(from, schema.node('commentMark', { edge: 'start', id, v: packJml(['w:commentRangeStart', { 'w:id': id }]) }))
  const meta: CommentMeta = { author: author.name, initials: author.initials ?? initialsOf(author.name), date: revisionDate() }
  return {
    id,
    tr,
    maps: [['comments', id, JSON.stringify(meta)]],
    stories: [{ id: `comment:${id}`, meta: { kind: 'comment' }, doc: commentStoryDoc(schema, context, text) }],
  }
}

/** A reply: a comment whose range sits with its parent's. */
export function replyToComment(state: EditorState, context: DocxViewContext, parentId: string, author: CommentAuthor, text: string): (StoryResult & { id: string }) | null {
  const { schema } = state
  let startPos: number | undefined
  let endPos: number | undefined
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'commentMark' && String(node.attrs.id) === parentId) {
      if (node.attrs.edge === 'start') startPos = pos + 1
      else if (node.attrs.edge === 'ref' || (node.attrs.edge === 'end' && endPos === undefined)) endPos = pos + 1
    }
    return true
  })
  if (startPos === undefined || endPos === undefined) return null
  const id = newStoryId()
  const tr = state.tr
  tr.insert(endPos, [
    schema.node('commentMark', { edge: 'end', id, v: packJml(['w:commentRangeEnd', { 'w:id': id }]) }),
    schema.node('commentMark', { edge: 'ref', id, v: packJml(['w:commentReference', { 'w:id': id }]), marks: packMarks(styleMarks(schema, context, 'CommentReference')) }),
  ])
  tr.insert(startPos, schema.node('commentMark', { edge: 'start', id, v: packJml(['w:commentRangeStart', { 'w:id': id }]) }))
  const meta: CommentMeta = { author: author.name, initials: author.initials ?? initialsOf(author.name), date: revisionDate(), parentId }
  return { id, tr, maps: [['comments', id, JSON.stringify(meta)]], stories: [{ id: `comment:${id}`, meta: { kind: 'comment' }, doc: commentStoryDoc(schema, context, text) }] }
}

export function setCommentResolved(context: DocxViewContext, id: string, done: boolean): StoryResult {
  const maps: MapEdit[] = []
  for (const [commentId, meta] of context.comments) {
    if (commentId !== id && meta.parentId !== id) continue
    maps.push(['comments', commentId, JSON.stringify({ ...meta, done: done || undefined })])
  }
  return { tr: null, maps, stories: [] }
}

/** Deletes a comment, its replies, and their markers. */
export function deleteComment(state: EditorState, context: DocxViewContext, id: string): StoryResult {
  const ids = new Set([id, ...[...context.comments].filter(([, meta]) => meta.parentId === id).map(([commentId]) => commentId)])
  const tr = state.tr
  const positions: number[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'commentMark' && ids.has(String(node.attrs.id))) positions.push(pos)
    return true
  })
  for (const pos of positions.reverse()) tr.delete(pos, pos + 1)
  return {
    tr: tr.docChanged ? tr : null,
    maps: [...ids].map((commentId): MapEdit => ['comments', commentId, null]),
    stories: [...ids].map((commentId) => ({ id: `comment:${commentId}`, meta: null })),
  }
}

export function editCommentText(state: EditorState, context: DocxViewContext, id: string, text: string): StoryResult {
  return { tr: null, maps: [], stories: [{ id: `comment:${id}`, meta: { kind: 'comment' }, doc: commentStoryDoc(state.schema, context, text) }] }
}

export interface CommentThread {
  id: string
  meta: CommentMeta
  text: string
  replies: { id: string; meta: CommentMeta; text: string }[]
  /** Position of the range start in the body, for ordering and scrolling. */
  pos: number
}

/** Comments as threads in reading order; `storyText` reads a comment's story. */
export function commentThreads(body: ProseMirrorNode, context: DocxViewContext, storyDocOf: (storyId: string) => ProseMirrorNode | undefined): CommentThread[] {
  const positions = new Map<string, number>()
  body.descendants((node, pos) => {
    if (node.type.name === 'commentMark' && (node.attrs.edge === 'start' || node.attrs.edge === 'ref')) {
      const id = String(node.attrs.id)
      if (!positions.has(id)) positions.set(id, pos)
    }
    return true
  })
  const text = (id: string) => {
    const doc = storyDocOf(`comment:${id}`)
    if (!doc) return ''
    return blocksText(doc, { styles: context.styles, numbering: context.numbering, counter: new ListCounter(context.numbering), notes: new Map(), noteCount: { footnote: 0, endnote: 0 } }).join('\n').trim()
  }
  const threads = new Map<string, CommentThread>()
  for (const [id, meta] of context.comments) {
    if (meta.parentId && context.comments.has(meta.parentId)) continue
    threads.set(id, { id, meta, text: text(id), replies: [], pos: positions.get(id) ?? Number.MAX_SAFE_INTEGER })
  }
  for (const [id, meta] of context.comments) {
    const parent = meta.parentId ? threads.get(meta.parentId) : undefined
    if (parent) parent.replies.push({ id, meta, text: text(id) })
  }
  for (const thread of threads.values()) thread.replies.sort((a, b) => (a.meta.date ?? '').localeCompare(b.meta.date ?? ''))
  return [...threads.values()].sort((a, b) => a.pos - b.pos)
}

/** Inserts a footnote (or endnote) reference at the cursor with a new note story. */
export function addNote(state: EditorState, context: DocxViewContext, kind: 'footnote' | 'endnote', text = ''): StoryResult & { id: string } {
  const { schema } = state
  const id = newStoryId()
  const refStyle = kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'
  const textStyle = kind === 'footnote' ? 'FootnoteText' : 'EndnoteText'
  const marks = packMarks(styleMarks(schema, context, refStyle).length ? styleMarks(schema, context, refStyle) : [schema.marks.vertAlign!.create({ v: packJml(['w:vertAlign', { 'w:val': 'superscript' }]) })])
  const reference = schema.node('noteRef', { kind, id, v: packJml([`w:${kind}Reference`, { 'w:id': id }]), marks })
  const tr = state.tr.replaceSelectionWith(reference, false)
  const noteMark = schema.node('inlineXml', { v: packJml([`w:${kind}Ref`, {}]), inRun: true, marks })
  const doc = storyDoc(schema, context, textStyle, ` ${text}`, noteMark)
  return { id, tr, maps: [], stories: [{ id: `${kind}:${id}`, meta: { kind }, doc }] }
}

export function readCommentMeta(json: string | undefined): CommentMeta {
  return parseJson<CommentMeta>(json) ?? {}
}
