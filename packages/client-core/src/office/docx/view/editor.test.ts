// @vitest-environment jsdom
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { docxCodec } from '../codec.js'
import { packJml } from '../jsonml.js'
import { MemoryAssetStore } from '../memory-assets.js'
import { fragmentToNode, storyFragmentName, writeFragment } from '../model.js'
import { docxSchema } from '../schema.js'
import { DocxEditor } from './editor.js'
import { listRevisions } from './track-changes.js'

const schema = docxSchema()
let assets: MemoryAssetStore
let doc: Y.Doc
let awareness: Awareness
let editor: DocxEditor
const storyView = () => (editor as unknown as { storyEditor: { view: EditorView } }).storyEditor.view

beforeEach(async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  doc = new Y.Doc()
  assets = new MemoryAssetStore()
  await docxCodec.createEmpty(doc, { name: 'a.docx', assets })
  doc.transact(() => {
    for (const kind of ['header', 'footer', 'footnote', 'endnote', 'comment']) {
      const id = `${kind}:1`
      doc.getMap('stories').set(id, JSON.stringify({ kind }))
      writeFragment(doc, doc.getXmlFragment(storyFragmentName(id)), schema.node('doc', null, [schema.node('paragraph', null, schema.text('Original'))]))
    }
  })
  awareness = new Awareness(doc)
  editor = new DocxEditor({ container: document.body, doc, awareness, assets, user: { name: 'Ada', color: '#ff0000' }, layout: 'web' })
})

afterEach(() => {
  editor.destroy()
  awareness.destroy()
  doc.destroy()
  vi.unstubAllGlobals()
})

describe('story review', () => {
  it.each(['accept', 'reject'] as const)('includes all non-comment stories and can %s open and closed stories', (action) => {
    editor.setMode('suggesting')
    editor.view.dispatch(editor.view.state.tr.insertText('Body', 1))
    for (const kind of ['header', 'footer', 'footnote', 'endnote', 'comment']) {
      editor.openStoryEditor(`${kind}:1`)
      storyView().dispatch(storyView().state.tr.insertText('New ', 1))
    }
    editor.openStoryEditor('header:1')
    const revisions = editor.revisions()
    expect(revisions.map(({ storyId }) => storyId)).toEqual([undefined, 'header:1', 'footer:1', 'footnote:1', 'endnote:1'])
    expect(new Set(revisions.map(({ key }) => key)).size).toBe(5)
    expect(action === 'accept' ? editor.acceptAll() : editor.rejectAll()).toBe(true)
    expect(editor.revisions()).toEqual([])
    for (const kind of ['header', 'footer', 'footnote', 'endnote']) {
      const node = fragmentToNode(doc.getXmlFragment(storyFragmentName(`${kind}:1`)))
      expect(node.textContent).toBe(action === 'accept' ? 'New Original' : 'Original')
      expect(listRevisions(node)).toEqual([])
    }
    expect(listRevisions(storyView().state.doc)).toEqual([])
    expect(listRevisions(fragmentToNode(doc.getXmlFragment(storyFragmentName('comment:1'))))).toHaveLength(1)
  })

  it('resolves a single closed story without changing another and can jump into it', () => {
    editor.setMode('suggesting')
    for (const kind of ['header', 'footer']) {
      editor.openStoryEditor(`${kind}:1`)
      storyView().dispatch(storyView().state.tr.insertText('New ', 1))
    }
    editor.closeStoryEditor()
    const revision = editor.revisions().find(({ storyId }) => storyId === 'header:1')!
    editor.resolveRevisions([revision], 'reject')
    expect(editor.revisions().map(({ storyId }) => storyId)).toEqual(['footer:1'])
    editor.goTo(0, 'footer:1')
    expect(editor.editingStory).toBe('footer:1')
  })
})

it('refreshes an open story immediately when permissions become read-only', () => {
  editor.openStoryEditor('header:1')
  const view = storyView()
  expect(view.editable).toBe(true)
  editor.setReadOnly(true)
  expect(view.editable).toBe(false)
  expect(view.dom.getAttribute('contenteditable')).toBe('false')
  const text = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT).nextNode()!
  text.nodeValue = `FORBIDDEN ${text.nodeValue}`
  ;(view as unknown as { domObserver: { flush(): void } }).domObserver.flush()
  expect(view.state.doc.textContent).toBe('Original')
  expect(fragmentToNode(doc.getXmlFragment(storyFragmentName('header:1'))).textContent).toBe('Original')
  editor.setReadOnly(false)
  expect(view.editable).toBe(true)
})

it('disables column and cell structure commands in Suggesting mode', () => {
  editor.insertTable(2, 2)
  let cell = 0
  editor.view.state.doc.descendants((node, pos) => {
    if (!cell && node.type.name === 'tableCell') cell = pos + 2
  })
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, cell)))
  expect(editor.state().tableColumnsEditable).toBe(true)
  editor.setMode('suggesting')
  const before = editor.view.state.doc
  expect(editor.state().tableColumnsEditable).toBe(false)
  for (const command of ['addColumnBefore', 'addColumnAfter', 'deleteColumn', 'mergeCells', 'splitCell'] as const) expect(editor[command]()).toBe(false)
  expect(editor.view.state.doc.eq(before)).toBe(true)
  expect(editor.revisions()).toEqual([])
})

it('preserves the original final paragraph mark when regenerating a table of contents', () => {
  const sectPr = packJml(['w:sectPr', {}, ['w:pgSz', { 'w:orient': 'landscape', 'w:w': '15840', 'w:h': '12240' }]])
  const markRPr = packJml(['w:rPr', {}, ['w:b', {}], ['w:ins', { 'w:id': '42', 'w:author': 'Grace' }]])
  editor.view.dispatch(editor.view.state.tr.replaceWith(0, editor.view.state.doc.content.size, [
    schema.node('paragraph', { outlineLvl: packJml(['w:outlineLvl', { 'w:val': '0' }]) }, schema.text('Heading')),
    schema.node('paragraph', { sectPr }, schema.text('Final')),
  ]))
  expect(editor.insertTableOfContents()).toBe(true)
  const first = editor.view.state.doc.firstChild!
  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(0, undefined, { ...first.attrs, sectPr, markRPr }))
  expect(editor.updateTableOfContents()).toBe(true)
  expect(editor.view.state.doc.firstChild!.attrs).toMatchObject({ sectPr, markRPr })
  expect(editor.view.state.doc.lastChild!.attrs.sectPr).toBe(sectPr)
})

describe('section undo', () => {
  it('undoes the final section type and split together in Editing mode', async () => {
    const sectPr = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'nextPage' }]])
    const original = schema.node('doc', null, [schema.node('paragraph', null, schema.text('ABC')), schema.node('paragraph', null, schema.text('DEF'))])
    doc.transact(() => {
      doc.getMap('docx').set('sectPr', sectPr)
      writeFragment(doc, doc.getXmlFragment('body'), original)
    }, 'setup')
    editor.setMode('editing')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 7)))
    expect(editor.insertSectionBreak('continuous')).toBe(true)
    const inserted = editor.view.state.doc
    expect(inserted.childCount).toBe(3)
    expect(doc.getMap('docx').get('sectPr')).toContain('continuous')
    expect(editor.undo()).toBe(true)
    expect(editor.view.state.doc.toJSON()).toEqual(original.toJSON())
    expect(doc.getMap('docx').get('sectPr')).toBe(sectPr)
    const { OoxmlPackage } = await import('../../ooxml/package.js')
    const xml = OoxmlPackage.read(await docxCodec.exportFile(doc, { name: 'a.docx', assets })).text('word/document.xml')!
    expect(xml.match(/<w:sectPr[ >]/g)).toHaveLength(1)
    expect(xml).toContain('<w:type w:val="nextPage"')
    expect(editor.redo()).toBe(true)
    expect(editor.view.state.doc.eq(inserted)).toBe(true)
    expect(doc.getMap('docx').get('sectPr')).toContain('continuous')
  })

  it('refuses all section break types in Suggesting mode without changing existing section properties', () => {
    const sectPr = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'oddPage' }]])
    const paragraphSection = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'nextPage' }]])
    doc.getMap('docx').set('sectPr', sectPr)
    const original = schema.node('doc', null, [schema.node('paragraph', { sectPr: paragraphSection }, schema.text('ABC')), schema.node('paragraph', null, schema.text('DEF'))])
    editor.view.dispatch(editor.view.state.tr.replaceWith(0, editor.view.state.doc.content.size, original.content))
    editor.setMode('suggesting')
    expect(editor.state().untrackedFormattingEditable).toBe(false)
    for (const pos of [2, 7]) {
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, pos)))
      for (const type of ['nextPage', 'continuous', 'evenPage', 'oddPage'] as const) expect(editor.insertSectionBreak(type)).toBe(false)
    }
    expect(editor.view.state.doc.eq(original)).toBe(true)
    expect(doc.getMap('docx').get('sectPr')).toBe(sectPr)
    expect(editor.revisions()).toEqual([])
    editor.setMode('editing')
    expect(editor.state().untrackedFormattingEditable).toBe(true)
  })

  it('keeps agent applyFile and unrelated map origins outside editor undo', async () => {
    const incoming = new Y.Doc()
    const assets = new MemoryAssetStore()
    try {
      await docxCodec.createEmpty(incoming, { name: 'a.docx', assets })
      incoming.getMap('docx').set('sectPr', packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'oddPage' }]]))
      writeFragment(incoming, incoming.getXmlFragment('body'), schema.node('doc', null, [schema.node('paragraph', null, schema.text('Agent content'))]))
      const bytes = await docxCodec.exportFile(incoming, { name: 'a.docx', assets })
      expect((await docxCodec.applyFile(doc, bytes, { name: 'a.docx', assets }, 'agent')).changed).toBe(true)
      const before = editor.view.state.doc
      const section = doc.getMap('docx').get('sectPr')
      const theme = JSON.stringify({ colors: { accent1: '#123456' }, fonts: {} })
      doc.transact(() => doc.getMap('docx').set('theme', theme), 'import')
      doc.transact(() => doc.getMap('settings').set('w:trackRevisions', packJml(['w:trackRevisions', {}])), 'import')
      expect(yUndoPluginKey.getState(editor.view.state).undoManager.undoStack).toHaveLength(0)
      editor.undo()
      expect(editor.view.state.doc.eq(before)).toBe(true)
      expect(doc.getMap('docx').get('sectPr')).toBe(section)
      expect(doc.getMap('docx').get('theme')).toBe(theme)
      expect(doc.getMap('settings').get('w:trackRevisions')).toBeTruthy()
      expect(yUndoPluginKey.getState(editor.view.state).undoManager.redoStack).toHaveLength(0)
      editor.redo()
      expect(editor.view.state.doc.eq(before)).toBe(true)
    } finally {
      incoming.destroy()
    }
  })
})
