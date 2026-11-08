// @vitest-environment jsdom
import { Fragment, Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { OoxmlPackage, resolveTarget } from '../../ooxml/package.js'
import { docxCodec } from '../codec.js'
import { copyRelatedParts, receiveCopiedParts } from '../copy-relationships.js'
import { elementToJml } from '../jsonml.js'
import { MemoryAssetStore } from '../memory-assets.js'
import { fragmentToNode, readDocxModel, storyFragmentName } from '../model.js'
import { CONTENT_TYPE, REL } from '../names.js'
import { relationshipReferences } from '../relationships.js'
import { withoutForeignParts } from './clipboard.js'
import { DocxEditor } from './editor.js'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const encode = (text: string) => new TextEncoder().encode(text)
const sect = (refs: string) => `<w:sectPr>${refs}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`
const story = (root: 'hdr' | 'ftr', text: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${root} ${W}><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:${root}>`

let assets: MemoryAssetStore
const open: { editor: DocxEditor; awareness: Awareness; doc: Y.Doc }[] = []

/** A Word file with two chapters, each with its own header, and a footer the second inherits. */
async function chapters(): Promise<Uint8Array> {
  const seed = new Y.Doc()
  await docxCodec.createEmpty(seed, { name: 'seed.docx', assets })
  const pkg = OoxmlPackage.read(await docxCodec.exportFile(seed, { name: 'seed.docx', assets }))
  seed.destroy()
  const main = pkg.mainPart()!
  pkg.set('word/header1.xml', encode(story('hdr', 'Chapter One header')))
  pkg.set('word/header2.xml', encode(story('hdr', 'Chapter Two header')))
  pkg.set('word/footer1.xml', encode(story('ftr', 'Shared footer')))
  pkg.setContentType('word/header1.xml', CONTENT_TYPE.header)
  pkg.setContentType('word/header2.xml', CONTENT_TYPE.header)
  pkg.setContentType('word/footer1.xml', CONTENT_TYPE.footer)
  const one = pkg.addRelationship(main, REL.header, 'header1.xml')
  const two = pkg.addRelationship(main, REL.header, 'header2.xml')
  const footer = pkg.addRelationship(main, REL.footer, 'footer1.xml')
  pkg.set(main, encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>`
    + `<w:p><w:pPr>${sect(`<w:headerReference w:type="default" r:id="${one}"/><w:footerReference w:type="default" r:id="${footer}"/>`)}</w:pPr><w:r><w:t>Chapter one text</w:t></w:r></w:p>`
    + `<w:p><w:r><w:t>Chapter two text</w:t></w:r></w:p>`
    + sect(`<w:headerReference w:type="default" r:id="${two}"/>`)
    + '</w:body></w:document>'))
  return pkg.write()
}

/** An editor on a file's bytes, a new document, or (with `replicaOf`) a copy of another one. */
async function editorFor(bytes?: Uint8Array, user = 'Ada', clientID?: number, replicaOf?: Y.Doc) {
  const doc = new Y.Doc()
  if (clientID !== undefined) doc.clientID = clientID
  if (replicaOf) Y.applyUpdate(doc, Y.encodeStateAsUpdate(replicaOf))
  else if (bytes) await docxCodec.importFile(doc, bytes, { name: 'a.docx', assets })
  else await docxCodec.createEmpty(doc, { name: 'a.docx', assets })
  const awareness = new Awareness(doc)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = new DocxEditor({ container, doc, awareness, assets, user: { name: user, color: '#f00' }, layout: 'print' })
  open.push({ editor, awareness, doc })
  editor.relayout()
  return { editor, doc }
}

/** A replica of `source` in its own editor, as a collaborator who opened the same document. */
function collaborator(source: Y.Doc, user: string, clientID: number) {
  return editorFor(undefined, user, clientID, source)
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

const storyText = (doc: Y.Doc, id: string) => fragmentToNode(doc.getXmlFragment(storyFragmentName(id))).textContent
const storyIds = (doc: Y.Doc, kind: 'header' | 'footer') => [...doc.getMap('stories').keys()].filter((key) => key.startsWith(`${kind}:`)).sort()
const storyView = (editor: DocxEditor) => (editor as unknown as { storyEditor: { view: EditorView } | null }).storyEditor?.view
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

function type(view: EditorView, text: string) {
  for (const char of text) {
    const { from, to } = view.state.selection
    const fallback = () => view.state.tr.insertText(char, from, to)
    if (!view.someProp('handleTextInput', (handle) => handle(view, from, to, char, fallback))) view.dispatch(fallback())
  }
}

/** Double-clicks the band a page shows for a story, as a person opening that header does. */
function openBand(editor: DocxEditor, storyId: string) {
  const root = (editor as unknown as { root: HTMLElement }).root
  const band = [...root.querySelectorAll<HTMLElement>('.docx-band [data-story]')].find((element) => element.dataset.story === storyId)!
  band.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  expect(editor.editingStory).toBe(storyId)
}

async function exported(doc: Y.Doc) {
  return OoxmlPackage.read(await docxCodec.exportFile(doc, { name: 'a.docx', assets }))
}

function assertResolved(pkg: OoxmlPackage, path = 'word/document.xml') {
  const xml = pkg.xml(path)?.documentElement
  if (xml) for (const ref of relationshipReferences(elementToJml(xml))) expect(pkg.relationships(path).some((rel) => rel.id === ref.id), `${path}: ${ref.id}`).toBe(true)
  for (const rel of pkg.relationships(path)) if (rel.targetMode !== 'External') expect(pkg.has(resolveTarget(path, rel.target)), `${path} -> ${rel.target}`).toBe(true)
}

function zipText(pkg: OoxmlPackage): string {
  return pkg.paths().map((path) => pkg.text(path) ?? '').join('\n')
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  document.elementFromPoint ??= () => null
  assets = new MemoryAssetStore()
})

afterEach(() => {
  for (const { editor, awareness, doc } of open.splice(0)) {
    editor.destroy()
    awareness.destroy()
    doc.destroy()
  }
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the open header or footer, not the body cursor', () => {
  it('names, removes, and sets a different first page for the header opened on another section', async () => {
    const { editor, doc } = await editorFor(await chapters())
    const [one, two] = storyIds(doc, 'header')
    expect([storyText(doc, one!), storyText(doc, two!)]).toEqual(['Chapter One header', 'Chapter Two header'])
    // The caret stays in chapter one; the second chapter's header opens from its page.
    expect(editor.headerFooter()).toMatchObject({ section: 0, header: { default: one } })
    openBand(editor, two!)
    expect(editor.view.state.selection.from).toBeLessThan(editor.view.state.doc.firstChild!.nodeSize)
    expect(editor.headerFooter()).toMatchObject({ section: 1, sections: 2, header: { default: two } })
    expect(editor.pageSetup().section).toBe(1)
    // Different first page belongs to the open header's section.
    expect(editor.setDifferentFirstPage(true)).toBe(true)
    expect(String(doc.getMap('docx').get('sectPr'))).toContain('w:titlePg')
    expect(String(editor.view.state.doc.firstChild!.attrs.sectPr)).not.toContain('w:titlePg')
    expect(editor.headerFooter().differentFirstPage).toBe(true)
    expect(editor.setDifferentFirstPage(false)).toBe(true)
    // Remove takes the open header away and leaves the first chapter's alone.
    expect(editor.removeHeaderFooter('header')).toBe(true)
    expect(storyIds(doc, 'header')).toEqual([one])
    expect(storyText(doc, one!)).toBe('Chapter One header')
    expect(editor.editingStory).toBeNull()
    // Closed, the body cursor's section counts again.
    expect(editor.headerFooter()).toMatchObject({ section: 0, header: { default: one } })
  })

  it('removes the open header by its story id, as the header bar does', async () => {
    const { editor, doc } = await editorFor(await chapters())
    const [one, two] = storyIds(doc, 'header')
    openBand(editor, two!)
    expect(editor.removeHeaderFooterStory(two!)).toBe(true)
    expect(storyIds(doc, 'header')).toEqual([one])
    expect(editor.removeHeaderFooterStory(two!)).toBe(false)
    expect(editor.removeHeaderFooterStory('footnote:1')).toBe(false)
  })

  it('opens a new first-page header for the open header\'s section after turning the option on', async () => {
    const { editor, doc } = await editorFor(await chapters())
    const [, two] = storyIds(doc, 'header')
    openBand(editor, two!)
    expect(editor.setDifferentFirstPage(true)).toBe(true)
    editor.relayout()
    const first = editor.addHeaderFooter('header', 'first')!
    expect(first).not.toBe(two)
    expect(editor.editingStory).toBe(first)
    expect(editor.headerFooter()).toMatchObject({ section: 1, differentFirstPage: true, header: { first, default: two } })
    expect(String(editor.view.state.doc.firstChild!.attrs.sectPr)).not.toContain('w:titlePg')
  })
})

describe('removing a header or footer', () => {
  it('is one undo step that brings back its text, part, and references, and redo removes it again', async () => {
    const { editor, doc } = await editorFor()
    type(editor.view, 'Body')
    const id = editor.addHeaderFooter('header')!
    type(storyView(editor)!, 'Running head')
    editor.closeStoryEditor()
    const rels = [...doc.getMap('rels').keys()]
    const sectPr = doc.getMap('docx').get('sectPr')
    expect(String(sectPr)).toContain('headerReference')
    expect(editor.removeHeaderFooter('header')).toBe(true)
    expect(doc.getMap('stories').has(id)).toBe(false)
    expect(storyText(doc, id)).toBe('')
    expect(editor.headerFooter().header).toEqual({})
    expect(editor.state().canUndo).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(doc.getMap('stories').has(id)).toBe(true)
    expect(storyText(doc, id)).toBe('Running head')
    expect([...doc.getMap('rels').keys()]).toEqual(rels)
    expect(doc.getMap('docx').get('sectPr')).toBe(sectPr)
    expect(editor.headerFooter().header.default).toBe(id)
    // Only the removal: the body's text stays.
    expect(editor.text()).toBe('Body')
    expect(editor.redo()).toBe(true)
    expect(doc.getMap('stories').has(id)).toBe(false)
    expect(editor.headerFooter().header).toEqual({})
    expect(editor.undo()).toBe(true)
    expect(storyText(doc, id)).toBe('Running head')
    editor.relayout()
    expect(editor.addHeaderFooter('header')).toBe(id)
    type(storyView(editor)!, '!')
    expect(storyText(doc, id)).toBe('Running head!')
    // The collaborator sees it back too.
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect(fragmentToNode(peer.getXmlFragment(storyFragmentName(id))).textContent).toBe('Running head!')
    peer.destroy()
  })

  it('undoes the removal of a header a file came with, from the open header', async () => {
    const { editor, doc } = await editorFor(await chapters())
    const [one, two] = storyIds(doc, 'header')
    openBand(editor, two!)
    expect(editor.removeHeaderFooterStory(two!)).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(storyIds(doc, 'header')).toEqual([one, two])
    expect(storyText(doc, two!)).toBe('Chapter Two header')
    expect(String(doc.getMap('docx').get('sectPr'))).toContain('headerReference')
    const pkg = await exported(doc)
    assertResolved(pkg)
    expect(pkg.text('word/header2.xml')).toContain('Chapter Two header')
  })
})

describe('exporting removed headers and footers', () => {
  it('leaves out the part, relationship, and content type of a removed header, and keeps the rest', async () => {
    const bytes = await chapters()
    const { editor, doc } = await editorFor(bytes)
    const [, two] = storyIds(doc, 'header')
    const part = two!.slice('header:'.length)
    openBand(editor, two!)
    expect(editor.removeHeaderFooterStory(two!)).toBe(true)
    const pkg = await exported(doc)
    assertResolved(pkg)
    expect(pkg.has(part)).toBe(false)
    expect(pkg.relationships('word/document.xml').some((rel) => resolveTarget('word/document.xml', rel.target) === part)).toBe(false)
    expect(pkg.text('[Content_Types].xml')).not.toContain(`/${part}`)
    expect(zipText(pkg)).not.toContain('Chapter Two header')
    expect(pkg.text('word/header1.xml')).toContain('Chapter One header')
    expect(pkg.text('word/footer1.xml')).toContain('Shared footer')
    // Opened again, it has no hidden header left over.
    const reimported = new Y.Doc()
    await docxCodec.importFile(reimported, pkg.write(), { name: 'b.docx', assets })
    expect([...readDocxModel(reimported).stories.values()].filter((entry) => entry.meta.kind === 'header').map((entry) => entry.doc.textContent)).toEqual(['Chapter One header'])
    reimported.destroy()
  })

  it('leaves out a removed footer that the file came with, even after a round trip', async () => {
    const { editor, doc } = await editorFor(await chapters())
    const [footer] = storyIds(doc, 'footer')
    expect(editor.removeHeaderFooterStory(footer!)).toBe(true)
    const pkg = await exported(doc)
    assertResolved(pkg)
    expect(pkg.has('word/footer1.xml')).toBe(false)
    expect(zipText(pkg)).not.toContain('Shared footer')
  })

  it('leaves out a header whose section break was deleted, as Word does when it saves', async () => {
    const { editor, doc } = await editorFor(await chapters())
    const [one, two] = storyIds(doc, 'header')
    // Deleting the first chapter's paragraph takes its section end, and the only reference to its header.
    editor.view.dispatch(editor.view.state.tr.delete(0, editor.view.state.doc.firstChild!.nodeSize))
    expect(editor.headerFooter()).toMatchObject({ sections: 1, header: { default: two } })
    const pkg = await exported(doc)
    assertResolved(pkg)
    expect(pkg.has(one!.slice('header:'.length))).toBe(false)
    expect(zipText(pkg)).not.toContain('Chapter One header')
    expect(pkg.text(two!.slice('header:'.length))).toContain('Chapter Two header')
  })

  it('keeps the header a section break pasted from another document brings with it', async () => {
    const { doc: source } = await editorFor(await chapters())
    // The first chapter's paragraph ends its section, which shows that chapter's header.
    const first = readDocxModel(source).body.firstChild!
    expect(String(first.attrs.sectPr)).toContain('headerReference')
    const copied = await copyRelatedParts(new Slice(Fragment.from(first), 0, 0), source, assets)
    const slice = withoutForeignParts(await receiveCopiedParts(copied, assets))
    expect(String(slice.content.firstChild!.attrs.sectPr)).toContain('headerReference')
    const { editor, doc } = await editorFor()
    editor.view.dispatch(editor.view.state.tr.replaceWith(0, editor.view.state.doc.content.size, [...slice.content.content, editor.view.state.schema.node('paragraph')]))
    const pkg = await exported(doc)
    assertResolved(pkg)
    const reference = /<w:headerReference\b[^>]*r:id="([^"]+)"/.exec(pkg.text('word/document.xml') ?? '')?.[1]
    const rel = pkg.relationships('word/document.xml').find((entry) => entry.id === reference)
    expect(rel?.type).toBe(REL.header)
    expect(pkg.text(resolveTarget('word/document.xml', rel!.target))).toContain('Chapter One header')
  })

  it('still saves an unedited file with its headers byte for byte', async () => {
    const bytes = await chapters()
    const { doc } = await editorFor(bytes)
    const pkg = await exported(doc)
    const original = OoxmlPackage.read(bytes)
    for (const path of original.paths()) expect(pkg.text(path), path).toBe(original.text(path))
  })
})

describe('collaborators writing the same section', () => {
  it('closes a new header whose reference lost to a collaborator\'s page setup, and leaves its text out of the file', async () => {
    const { editor: ada, doc: adaDoc } = await editorFor(undefined, 'Ada', 1000)
    const { editor: grace, doc: graceDoc } = await collaborator(adaDoc, 'Grace', 2000)
    const removed: string[] = []
    ada.on('headerFooterRemoved', (id) => removed.push(id))
    const header = ada.addHeaderFooter('header')!
    type(storyView(ada)!, 'Ada header')
    expect(grace.setPageSetup({ orientation: 'landscape' })).toBe(true)
    sync(adaDoc, graceDoc)
    // The higher client id wins a concurrent write of one map key.
    expect(ada.pageSetup().orientation).toBe('landscape')
    expect(ada.headerFooter().header).toEqual({})
    await flush()
    expect(ada.editingStory).toBeNull()
    expect(removed).toEqual([header])
    const pkg = await exported(adaDoc)
    assertResolved(pkg)
    expect(zipText(pkg)).not.toContain('Ada header')
    expect(pkg.relationships('word/document.xml').some((rel) => rel.type === REL.header)).toBe(false)
  })

  it('keeps a header open when its reference wins', async () => {
    const { editor: ada, doc: adaDoc } = await editorFor(undefined, 'Ada', 2000)
    const { editor: grace, doc: graceDoc } = await collaborator(adaDoc, 'Grace', 1000)
    const removed: string[] = []
    ada.on('headerFooterRemoved', (id) => removed.push(id))
    const header = ada.addHeaderFooter('header')!
    grace.setPageSetup({ orientation: 'landscape' })
    sync(adaDoc, graceDoc)
    await flush()
    expect(ada.editingStory).toBe(header)
    expect(removed).toEqual([])
    expect(grace.headerFooter().header.default).toBe(header)
  })

  it('closes the header a collaborator removes while it is open', async () => {
    const { editor: ada, doc: adaDoc } = await editorFor(await chapters(), 'Ada', 1000)
    const { editor: grace, doc: graceDoc } = await collaborator(adaDoc, 'Grace', 2000)
    const removed: string[] = []
    ada.on('headerFooterRemoved', (id) => removed.push(id))
    const [one] = storyIds(adaDoc, 'header')
    openBand(ada, one!)
    expect(grace.removeHeaderFooterStory(one!)).toBe(true)
    sync(adaDoc, graceDoc)
    await flush()
    expect(ada.editingStory).toBeNull()
    expect(removed).toEqual([one])
  })

  it('leaves no reference to a header removed while a collaborator rewrote the section', async () => {
    const { editor: ada, doc: adaDoc } = await editorFor(undefined, 'Ada', 2000)
    const header = ada.addHeaderFooter('header')!
    type(storyView(ada)!, 'Short-lived')
    ada.closeStoryEditor()
    const { editor: grace, doc: graceDoc } = await collaborator(adaDoc, 'Grace', 1000)
    // Grace removes it while Ada turns the page; Ada's section properties, still with its reference, win.
    expect(grace.removeHeaderFooterStory(header)).toBe(true)
    expect(ada.setPageSetup({ orientation: 'landscape' })).toBe(true)
    sync(adaDoc, graceDoc)
    expect(String(graceDoc.getMap('docx').get('sectPr'))).toContain('headerReference')
    expect(graceDoc.getMap('stories').has(header)).toBe(false)
    const pkg = await exported(graceDoc)
    assertResolved(pkg)
    expect(pkg.text('word/document.xml')).not.toContain('headerReference')
    expect(pkg.text('word/document.xml')).toContain('w:orient="landscape"')
  })

  it('leaves out a header the file came with when its removal raced a collaborator\'s section write', async () => {
    const { editor: ada, doc: adaDoc } = await editorFor(await chapters(), 'Ada', 2000)
    const { editor: grace, doc: graceDoc } = await collaborator(adaDoc, 'Grace', 1000)
    const [one, two] = storyIds(adaDoc, 'header')
    // Grace removes the second chapter's header while Ada turns that section; Ada's section
    // properties, still with its reference, win. The original file still has its relationship.
    expect(grace.removeHeaderFooterStory(two!)).toBe(true)
    expect(ada.setPageSetup({ orientation: 'landscape' })).toBe(true)
    sync(adaDoc, graceDoc)
    expect(String(graceDoc.getMap('docx').get('sectPr'))).toContain('headerReference')
    // The editor shows the second chapter inheriting the first one's header; the file must too.
    grace.goTo(grace.view.state.doc.content.size - 1)
    expect(grace.headerFooter()).toMatchObject({ section: 1, header: { default: one } })
    for (const doc of [adaDoc, graceDoc]) {
      const pkg = await exported(doc)
      assertResolved(pkg)
      expect(zipText(pkg)).not.toContain('Chapter Two header')
      expect(pkg.has(two!.slice('header:'.length))).toBe(false)
      expect(pkg.text('word/header1.xml')).toContain('Chapter One header')
      expect(pkg.text('word/document.xml')).toContain('w:orient="landscape"')
    }
  })
})
