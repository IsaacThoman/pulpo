// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { docxCodec } from '../codec.js'
import { MemoryAssetStore } from '../memory-assets.js'
import { fragmentToNode, storyFragmentName, writeFragment } from '../model.js'
import { docxSchema } from '../schema.js'
import { DocxEditor } from './editor.js'
import { listRevisions } from './track-changes.js'

const schema = docxSchema()
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
  const assets = new MemoryAssetStore()
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
