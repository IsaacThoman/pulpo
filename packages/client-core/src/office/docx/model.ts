import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { updateYFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { ThemeInfo } from './css.js'
import { DOCX_BODY_FRAGMENT } from './format.js'
import { docxSchema } from './schema.js'

/**
 * How a Word document lives in a Y.Doc.
 *
 * - `body` (Y.XmlFragment): the main story, in the docx ProseMirror schema.
 * - `story:<id>` (Y.XmlFragment): every other story: `header:<part>`, `footer:<part>`,
 *   `footnote:<id>`, `endnote:<id>`, `comment:<id>`. Root-level types, so two replicas creating
 *   the same story merge instead of one replacing the other.
 * - `stories` (Y.Map): story id → JSON `StoryMeta`.
 * - `styles` (Y.Map): `style:<styleId>`, `docDefaults`, `latentStyles` → JsonML of the element.
 * - `numbering` (Y.Map): `abstract:<id>`, `num:<id>`, `picBullet:<id>` → JsonML.
 * - `comments` (Y.Map): comment id → JSON `CommentMeta`.
 * - `settings` (Y.Map): modeled `w:settings` children by name → JsonML, or '' when absent.
 * - `rels` (Y.Map): relationships of the main part by id → JSON `{ type, target, targetMode? }`.
 * - `parts` (Y.Map): every part of the original package by path → JSON `PartRef` (bytes in assets).
 * - `docx` (Y.Map): everything else (`DocxMetaKey`).
 *
 * Keyed maps keep concurrent edits to different styles, lists, or comments apart; each value is
 * replaced whole, last writer wins, which is what Word does too.
 */

export const BODY_FRAGMENT = DOCX_BODY_FRAGMENT
export const STORY_PREFIX = 'story:'
export const DOCX_MAPS = ['stories', 'styles', 'numbering', 'comments', 'settings', 'rels', 'parts', 'docx'] as const
export type DocxMapName = (typeof DOCX_MAPS)[number]

export type StoryKind = 'header' | 'footer' | 'footnote' | 'endnote' | 'comment'

export interface StoryMeta {
  kind: StoryKind
  /** Headers and footers: their part. */
  part?: string
  /** Attributes of the story's root element (`w:hdr`, `w:footnote`, `w:comment`). */
  attrs?: Record<string, string>
  /** The file's story had no paragraphs; the editor's placeholder paragraph is not written back. */
  empty?: boolean
}

export interface CommentMeta {
  author?: string
  initials?: string
  date?: string
  /** The comment this one replies to. */
  parentId?: string
  done?: boolean
  /** Attributes of `w:comment` other than id, author, initials, and date. */
  attrs?: Record<string, string>
  /** `w15:commentEx` attributes besides paraId/parent/done, kept for export. */
  durableId?: string
}

export interface PartRef {
  hash: string
  size: number
}

export type DocxMetaKey =
  | 'schemaVersion'
  /** `word/document.xml` or wherever the officeDocument relationship points. */
  | 'mainPart'
  /** Attributes of `w:document` (namespace declarations, `mc:Ignorable`, conformance). */
  | 'documentAttrs'
  /** `w:document` children other than the body (background), as a JsonML array. */
  | 'documentExtra'
  /** `w:document` children after the body. */
  | 'documentTail'
  /** Attributes of `w:body`. */
  | 'bodyAttrs'
  /** The final section's `w:sectPr`. */
  | 'sectPr'
  /** Markers after the last block of the body. */
  | 'bodyTrail'
  /** '1' when the file's body had no blocks (see StoryMeta.empty). */
  | 'emptyBody'
  /** JSON `ThemeInfo`, read from the theme part for rendering. */
  | 'theme'
  | `fingerprint:${string}`
  /** Root attributes of a story part (`w:hdr`, `w:footnotes`, `w:comments`). */
  | `root:${string}`

export interface DocxModel {
  body: ProseMirrorNode
  stories: Map<string, { meta: StoryMeta; doc: ProseMirrorNode }>
  maps: Record<DocxMapName, Map<string, string>>
}

export function emptyMaps(): Record<DocxMapName, Map<string, string>> {
  return Object.fromEntries(DOCX_MAPS.map((name) => [name, new Map<string, string>()])) as Record<DocxMapName, Map<string, string>>
}

export function storyFragmentName(storyId: string): string {
  return STORY_PREFIX + storyId
}

export function emptyStoryDoc(): ProseMirrorNode {
  const schema = docxSchema()
  return schema.node('doc', null, [schema.node('paragraph')])
}

export function fragmentToNode(fragment: Y.XmlFragment): ProseMirrorNode {
  const json = yXmlFragmentToProsemirrorJSON(fragment) as { type: string; content?: unknown[] }
  if (!json.content?.length) return emptyStoryDoc()
  return ProseMirrorNode.fromJSON(docxSchema(), json)
}

export function readDocxMap(doc: Y.Doc, name: DocxMapName): Map<string, string> {
  const result = new Map<string, string>()
  doc.getMap<string>(name).forEach((value, key) => {
    if (typeof value === 'string') result.set(key, value)
  })
  return result
}

/** The document as a model; stories whose meta is missing are skipped. */
export function readDocxModel(doc: Y.Doc): DocxModel {
  const maps = Object.fromEntries(DOCX_MAPS.map((name) => [name, readDocxMap(doc, name)])) as DocxModel['maps']
  const stories = new Map<string, { meta: StoryMeta; doc: ProseMirrorNode }>()
  for (const [id, json] of maps.stories) {
    const meta = parseJson<StoryMeta>(json)
    if (!meta) continue
    stories.set(id, { meta, doc: fragmentToNode(doc.getXmlFragment(storyFragmentName(id))) })
  }
  return { body: fragmentToNode(doc.getXmlFragment(BODY_FRAGMENT)), stories, maps }
}

/**
 * Makes a fragment hold `node` with a minimal diff: unchanged paragraphs keep their Y items, so
 * concurrent edits to them survive.
 */
export function writeFragment(doc: Y.Doc, fragment: Y.XmlFragment, node: ProseMirrorNode): void {
  updateYFragment(doc, fragment, node, { mapping: new Map(), isOMark: new Map() })
}

function syncMap(target: Y.Map<string>, values: Map<string, string>): boolean {
  let changed = false
  target.forEach((value, key) => {
    if (!values.has(key)) {
      target.delete(key)
      changed = true
    } else if (value !== values.get(key)) {
      target.set(key, values.get(key)!)
      changed = true
    }
  })
  for (const [key, value] of values) {
    if (!target.has(key)) {
      target.set(key, value)
      changed = true
    }
  }
  return changed
}

function fragmentMatches(fragment: Y.XmlFragment, node: ProseMirrorNode): boolean {
  return fragment.length > 0 && fragmentToNode(fragment).eq(node)
}

/**
 * Writes a model into a Y.Doc as a minimal diff (in the caller's transaction). Returns whether
 * anything changed.
 */
export function writeDocxModel(doc: Y.Doc, model: DocxModel): boolean {
  let changed = false
  const body = doc.getXmlFragment(BODY_FRAGMENT)
  if (!fragmentMatches(body, model.body)) {
    writeFragment(doc, body, model.body)
    changed = true
  }
  const previous = readDocxMap(doc, 'stories')
  for (const [id, story] of model.stories) {
    const fragment = doc.getXmlFragment(storyFragmentName(id))
    if (!fragmentMatches(fragment, story.doc)) {
      writeFragment(doc, fragment, story.doc)
      changed = true
    }
  }
  for (const id of previous.keys()) {
    if (model.stories.has(id)) continue
    const fragment = doc.getXmlFragment(storyFragmentName(id))
    if (fragment.length) {
      fragment.delete(0, fragment.length)
      changed = true
    }
  }
  const stories = new Map([...model.stories].map(([id, story]) => [id, JSON.stringify(story.meta)]))
  const maps: DocxModel['maps'] = { ...model.maps, stories }
  for (const name of DOCX_MAPS) changed = syncMap(doc.getMap<string>(name), maps[name]) || changed
  return changed
}

export function parseJson<T>(value: string | undefined | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

export function readTheme(doc: Y.Doc): ThemeInfo | undefined {
  return parseJson<ThemeInfo>(doc.getMap<string>('docx').get('theme'))
}
