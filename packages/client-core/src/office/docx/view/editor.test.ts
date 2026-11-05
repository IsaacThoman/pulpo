// @vitest-environment jsdom
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { Fragment, Slice } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { OoxmlPackage, resolveTarget } from '../../ooxml/package.js'
import { blankDocx } from '../blank.js'
import { NEW_PART_NAMESPACES, REL } from '../names.js'
import { relationshipReferences } from '../relationships.js'
import { acceptedText, baseText, docxToText } from '../text.js'
import { docxCodec } from '../codec.js'
import { elementToJml, packJml } from '../jsonml.js'
import { MemoryAssetStore } from '../memory-assets.js'
import { readDocxModel, fragmentToNode, storyFragmentName, writeFragment } from '../model.js'
import { docxSchema } from '../schema.js'
import { clipboardSerializer, rememberCopy } from './clipboard.js'
import { listDefinition } from './commands.js'
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
  it.each(['accept', 'reject'] as const)('includes all stories and can %s open and closed stories', (action) => {
    editor.setMode('suggesting')
    editor.view.dispatch(editor.view.state.tr.insertText('Body', 1))
    for (const kind of ['header', 'footer', 'footnote', 'endnote', 'comment']) {
      editor.openStoryEditor(`${kind}:1`)
      storyView().dispatch(storyView().state.tr.insertText('New ', 1))
    }
    editor.openStoryEditor('header:1')
    const revisions = editor.revisions()
    expect(revisions.map(({ storyId }) => storyId)).toEqual([undefined, 'header:1', 'footer:1', 'footnote:1', 'endnote:1', 'comment:1'])
    expect(new Set(revisions.map(({ key }) => key)).size).toBe(6)
    expect(action === 'accept' ? editor.acceptAll() : editor.rejectAll()).toBe(true)
    expect(editor.revisions()).toEqual([])
    for (const kind of ['header', 'footer', 'footnote', 'endnote', 'comment']) {
      const node = fragmentToNode(doc.getXmlFragment(storyFragmentName(`${kind}:1`)))
      expect(node.textContent).toBe(action === 'accept' ? 'New Original' : 'Original')
      expect(listRevisions(node)).toEqual([])
    }
    expect(listRevisions(storyView().state.doc)).toEqual([])
    expect(listRevisions(fragmentToNode(doc.getXmlFragment(storyFragmentName('comment:1'))))).toHaveLength(0)
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

it.each(['header', 'footer', 'footnote', 'endnote'])('keeps the active %s editor connected and focused during remote body repagination', (kind) => {
  doc.transact(() => {
    doc.getMap('rels').set('rStory', JSON.stringify({ type: `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}`, target: '/1' }))
    doc.getMap('docx').set('sectPr', packJml(['w:sectPr', {}, [`w:${kind}Reference`, { 'w:type': 'default', 'r:id': 'rStory' }]]))
  })
  if (kind === 'footnote' || kind === 'endnote') editor.view.dispatch(editor.view.state.tr.insert(1, schema.node('noteRef', { kind, id: '1' })))
  editor.view.dispatch(editor.view.state.tr.insertText('Body', 1))
  editor.setLayout('print')
  editor.relayout()
  const over = document.querySelector<HTMLElement>(`[data-story="${kind}:1"]`)!
  expect(over).toBeTruthy()
  editor.openStoryEditor(`${kind}:1`, over)
  const view = storyView()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)))
  view.focus()
  const replica = new Y.Doc()
  try {
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
    const text = (replica.getXmlFragment('body').get(0) as Y.XmlElement).get(0) as Y.XmlText
    text.insert(0, 'Remote')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica), 'remote')
    editor.relayout()
    expect(storyView()).toBe(view)
    expect(view.dom.isConnected).toBe(true)
    expect(view.hasFocus()).toBe(true)
    expect(view.state.selection.from).toBe(4)
    expect(document.querySelector(`[data-story="${kind}:1"]`)?.getAttribute('style')).toContain('visibility: hidden')
    view.dispatch(view.state.tr.insertText('Typed'))
    expect(fragmentToNode(doc.getXmlFragment(storyFragmentName(`${kind}:1`))).textContent).toBe('OriTypedginal')
  } finally {
    replica.destroy()
  }
})

describe('active story commands', () => {
  it.each(['header', 'footer', 'footnote', 'endnote'])('schedules pagination for local %s edits, including undo', (kind) => {
    editor.openStoryEditor(`${kind}:1`)
    const layout = vi.spyOn(editor, 'scheduleLayout')
    const view = storyView()
    view.dispatch(view.state.tr.insertText('New ', 1))
    expect(layout).toHaveBeenCalled()
    layout.mockClear()
    editor.undo()
    expect(layout).toHaveBeenCalled()
    layout.mockClear()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(layout).not.toHaveBeenCalled()
  })

  it.each(['header', 'footer', 'footnote', 'endnote'])('rejects unsupported %s comments without touching the stale body selection', (kind) => {
    editor.view.dispatch(editor.view.state.tr.insertText('Body selection', 1))
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 5)))
    const body = editor.view.state.doc
    editor.openStoryEditor(`${kind}:1`)
    const story = storyView().state.doc
    storyView().dispatch(storyView().state.tr.setSelection(TextSelection.create(story, 1, 5)))
    expect(editor.canComment).toBe(false)
    expect(editor.addComment('Must not comment on body')).toBeNull()
    expect(editor.view.state.doc.eq(body)).toBe(true)
    expect(storyView().state.doc.eq(story)).toBe(true)
    expect(doc.getMap('comments').size).toBe(0)
  })

  it.each(['header', 'footer', 'footnote', 'endnote'])('targets %s find/replace, formatting state, and undo without editing body', (kind) => {
    editor.view.dispatch(editor.view.state.tr.insertText('Original body', 1))
    const body = editor.view.state.doc
    editor.openStoryEditor(`${kind}:1`)
    expect(editor.find('Original')).toBe(1)
    expect(storyView().state.selection.from).toBe(1)
    expect(editor.replaceAll('Story', 'Original')).toBe(1)
    expect(storyView().state.doc.textContent).toBe('Story')
    expect(editor.view.state.doc.eq(body)).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(storyView().state.doc.textContent).toBe('Original')
    expect(editor.redo()).toBe(true)
    expect(storyView().state.doc.textContent).toBe('Story')
    expect(editor.find('Story')).toBe(1)
    expect(editor.replace('New story', 'Story')).toBe(true)
    expect(storyView().state.doc.textContent).toBe('New story')
    editor.toggleBold()
    expect(editor.state().bold).toBe(true)
    expect(editor.view.state.doc.eq(body)).toBe(true)
  })

  it('refreshes story decorations and toolbar state after style/numbering map edits', () => {
    editor.openStoryEditor('header:1')
    editor.toggleList('decimal')
    const view = storyView()
    const node = view.state.doc.firstChild!
    view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, pStyle: 'StoryStyle' }))
    doc.getMap('styles').set('style:StoryStyle', packJml(['w:style', { 'w:styleId': 'StoryStyle', 'w:type': 'paragraph' }, ['w:rPr', {}, ['w:b', {}]]]))
    expect(editor.state().bold).toBe(true)
    const numberKey = [...doc.getMap<string>('numbering').keys()].find((key) => key.startsWith('abstract:'))!
    const definition = JSON.parse(doc.getMap<string>('numbering').get(numberKey)!)
    definition.find((child: unknown) => Array.isArray(child) && child[0] === 'w:lvl')[2] = ['w:start', { 'w:val': '7' }]
    doc.getMap('numbering').set(numberKey, JSON.stringify(definition))
    expect(view.dom.querySelector('[data-label]')?.getAttribute('data-label')).toBe('7.')
  })

  it('does not apply document-only TOC or section commands through a story selection', () => {
    editor.view.dispatch(editor.view.state.tr.insertText('Body', 1))
    const body = editor.view.state.doc
    const section = doc.getMap('docx').get('sectPr')
    editor.openStoryEditor('header:1')
    expect(editor.insertTableOfContents()).toBe(false)
    expect(editor.updateTableOfContents()).toBe(false)
    expect(editor.insertSectionBreak('continuous')).toBe(false)
    expect(editor.insertNote('footnote')).toBeNull()
    expect(editor.view.state.doc.eq(body)).toBe(true)
    expect(doc.getMap('docx').get('sectPr')).toBe(section)
  })

  it('shows and hides suggestion markup in active and static story surfaces', () => {
    editor.openStoryEditor('header:1')
    editor.setMode('suggesting')
    storyView().dispatch(storyView().state.tr.insertText('Suggested ', 1))
    editor.setShowMarkup(false)
    expect(storyView().dom.closest('.docx-final')).toBeTruthy()
    editor.setShowMarkup(true)
    expect(storyView().dom.closest('.docx-final')).toBeNull()
  })
})

it('notifies find panels when a story search has no matches or is cleared', () => {
  editor.openStoryEditor('header:1')
  editor.find('Original')
  const update = vi.fn()
  editor.on('update', update)
  editor.find('Absent')
  expect(editor.findState().count).toBe(0)
  expect(update).toHaveBeenCalled()
  update.mockClear()
  editor.clearFind()
  expect(update).toHaveBeenCalled()
})

it.each(['accept', 'reject'] as const)('uses the shared %s-all semantic view for body and note paragraph boundaries', (action) => {
  const kind = action === 'accept' ? 'del' : 'ins'
  const paragraph = (text: string, boundary = false) => schema.node('paragraph', { markRPr: boundary ? packJml(['w:rPr', {}, [`w:${kind}`, { 'w:id': '70' }]]) : null }, schema.text(text))
  const body = schema.node('doc', null, [paragraph('foo', true), schema.node('paragraph', null, [schema.text('bar'), schema.node('noteRef', { id: '1', kind: 'footnote' })])])
  writeFragment(doc, doc.getXmlFragment('body'), body)
  writeFragment(doc, doc.getXmlFragment(storyFragmentName('footnote:1')), schema.node('doc', null, [paragraph('note A', true), paragraph('note B')]))
  doc.getMap('comments').set('1', JSON.stringify({ author: 'Ada' }))
  writeFragment(doc, doc.getXmlFragment(storyFragmentName('comment:1')), schema.node('doc', null, [paragraph('comment A', true), paragraph('comment B')]))
  const before = Y.encodeStateAsUpdate(doc)
  const expected = action === 'accept' ? acceptedText(readDocxModel(doc)) : baseText(readDocxModel(doc))
  expect(Buffer.from(Y.encodeStateAsUpdate(doc)).equals(Buffer.from(before))).toBe(true)
  expect(action === 'accept' ? editor.acceptAll() : editor.rejectAll()).toBe(true)
  expect(docxToText(readDocxModel(doc), 'raw')).toBe(expected)
  expect(editor.view.state.doc.firstChild!.textContent).toBe('foobar')
  expect(fragmentToNode(doc.getXmlFragment(storyFragmentName('footnote:1'))).firstChild!.textContent).toBe('note Anote B')
})

describe('find matches after edits', () => {
  it.each(['body', 'header:1'])('drops a changed match in %s before replacing', (storyId) => {
    if (storyId !== 'body') editor.openStoryEditor(storyId)
    const view = storyId === 'body' ? editor.view : storyView()
    view.dispatch(view.state.tr.replaceWith(1, view.state.doc.content.size - 1, schema.text('cat')))
    expect(editor.find('cat')).toBe(1)
    view.dispatch(view.state.tr.insertText('o', 2))
    expect(editor.findState()).toEqual({ index: -1, count: 0 })
    expect(editor.replace('dog', 'cat')).toBe(false)
    expect(view.state.doc.textContent).toBe('coat')
  })

  it('maps matches through a transaction with several steps and preserves the active result', () => {
    editor.view.dispatch(editor.view.state.tr.insertText('cat cat cat', 1))
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1)))
    editor.find('cat')
    editor.findStep(1)
    const tr = editor.view.state.tr.insertText('o', 2).insertText('Prefix ', 1)
    editor.view.dispatch(tr)
    expect(editor.findState()).toEqual({ index: 0, count: 2 })
    expect(editor.replace('dog', 'cat')).toBe(true)
    expect(editor.view.state.doc.textContent).toBe('Prefix coat dog cat')
  })

  it.each([
    ['cat cat', 'cat', { wholeWord: true }, 4, 's', 'cats cat'],
    ['Cat cat', 'Cat', { matchCase: true }, 1, 's', 'sCat cat'],
  ])('rechecks case and word boundaries for %s', (text, query, options, position, insertion, expected) => {
    editor.view.dispatch(editor.view.state.tr.insertText(text, 1))
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1)))
    editor.find(query, options)
    editor.view.dispatch(editor.view.state.tr.insertText(insertion, position))
    expect(editor.view.state.doc.textContent).toBe(expected)
    if ('wholeWord' in options && options.wholeWord) expect(editor.findState().count).toBe(1)
    else {
      expect(editor.replace('dog', 'cat', options)).toBe(false)
      expect(editor.view.state.doc.textContent).toBe(expected)
    }
  })

  it.each(['body', 'header:1'])('refreshes an active %s search, including zero results, after remote Yjs changes', (storyId) => {
    if (storyId !== 'body') editor.openStoryEditor(storyId)
    const view = storyId === 'body' ? editor.view : storyView()
    const fragment = storyId === 'body' ? 'body' : storyFragmentName(storyId)
    view.dispatch(view.state.tr.replaceWith(1, view.state.doc.content.size - 1, schema.text('cat')))
    editor.find('cat')
    const remote = new Y.Doc()
    try {
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
      const vector = Y.encodeStateVector(remote)
      writeFragment(remote, remote.getXmlFragment(fragment), schema.node('doc', null, [schema.node('paragraph', null, schema.text('coat cat'))]))
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, vector), 'remote-test')
      expect(editor.findState().count).toBe(1)
      expect(view.dom.querySelector('.docx-find-match')?.textContent).toBe('cat')
      expect(editor.replace('dog', 'cat')).toBe(true)
      expect(view.state.doc.textContent).toBe('coat dog')
      editor.find('absent')
      const later = Y.encodeStateVector(remote)
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
      writeFragment(remote, remote.getXmlFragment(fragment), schema.node('doc', null, [schema.node('paragraph', null, schema.text('absent absent'))]))
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, later), 'remote-test')
      expect(editor.findState().count).toBe(2)
      expect(editor.replaceAll('present', 'absent')).toBe(2)
      expect(view.state.doc.textContent).toBe('present present')
    } finally { remote.destroy() }
  })

  it('does not search again after clearing, and validates dotted-I ranges before replacement', () => {
    editor.view.dispatch(editor.view.state.tr.insertText('İ cat', 1))
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1)))
    editor.find('i')
    editor.view.dispatch(editor.view.state.tr.insertText('Prefix ', 1))
    expect(editor.replace('X', 'i')).toBe(true)
    expect(editor.view.state.doc.textContent).toBe('Prefix X cat')
    editor.clearFind()
    writeFragment(doc, doc.getXmlFragment('body'), schema.node('doc', null, [schema.node('paragraph', null, schema.text('i i'))]))
    expect(editor.findState().count).toBe(0)
  })
})

it.each(['toolbar', 'Enter', 'Backspace'])('suppresses inherited list numbering with %s and reports resolved toolbar state', (action) => {
  doc.transact(() => {
    doc.getMap('styles').set('style:BaseList', packJml(['w:style', { 'w:type': 'paragraph', 'w:styleId': 'BaseList' }, ['w:pPr', {}, ['w:numPr', {}, ['w:numId', { 'w:val': '1' }]]]]))
    doc.getMap('styles').set('style:DerivedList', packJml(['w:style', { 'w:type': 'paragraph', 'w:styleId': 'DerivedList' }, ['w:basedOn', { 'w:val': 'BaseList' }]]))
    doc.getMap('numbering').set('abstract:1', packJml(listDefinition('decimal', '1')))
    for (const id of ['1', '2']) doc.getMap('numbering').set(`num:${id}`, packJml(['w:num', { 'w:numId': id }, ['w:abstractNumId', { 'w:val': '1' }]]))
  })
  const view = editor.view
  view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { pStyle: 'DerivedList' }))
  expect(editor.state().list).toBe('decimal')
  view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { pStyle: 'DerivedList', numPr: packJml(['w:numPr', {}, ['w:numId', { 'w:val': '2' }]]) }))
  expect(editor.state().list).toBe('decimal')
  if (action === 'toolbar') expect(editor.toggleList('decimal')).toBe(true)
  else {
    const event = new KeyboardEvent('keydown', { key: action, bubbles: true, cancelable: true })
    view.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  }
  expect(editor.state().list).toBeNull()
  expect(view.state.doc.childCount).toBe(1)
  expect(view.state.doc.firstChild!.attrs.pStyle).toBe('DerivedList')
  expect(view.state.doc.firstChild!.attrs.numPr).toContain('"w:val":"0"')
  expect(editor.toggleList('decimal')).toBe(true)
  expect(editor.state().list).toBe('decimal')
  expect(editor.toggleList('decimal')).toBe(true)
  expect(editor.state().list).toBeNull()
})

it('does not put story numbering changes in the body undo stack', () => {
  editor.openStoryEditor('header:1')
  editor.toggleList('decimal')
  expect(yUndoPluginKey.getState(storyView().state).undoManager.undoStack.length).toBeGreaterThan(0)
  expect(yUndoPluginKey.getState(editor.view.state).undoManager.undoStack.length).toBe(0)
  const numbering = JSON.stringify([...doc.getMap('numbering')])
  editor.closeStoryEditor()
  expect(editor.state().canUndo).toBe(false)
  editor.undo()
  expect(JSON.stringify([...doc.getMap('numbering')])).toBe(numbering)
})

it('keeps outline and bookmark navigation in the active story', () => {
  editor.openStoryEditor('header:1')
  const view = storyView()
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.node('paragraph', { outlineLvl: packJml(['w:outlineLvl', { 'w:val': '0' }]) }, [schema.node('bookmark', { edge: 'start', id: '5', name: 'StoryBookmark' }), schema.text('Story heading') ])))
  const entry = editor.outline()[0]!
  expect(entry.storyId).toBe('header:1')
  editor.goTo(entry.pos, entry.storyId)
  expect(editor.editingStory).toBe('header:1')
  editor.goToBookmark('StoryBookmark')
  expect(editor.editingStory).toBe('header:1')
  expect(editor.hasFocus).toBe(true)
  editor.blur()
  expect(editor.hasFocus).toBe(false)
})

it('refreshes an open note number when the body gains an earlier reference', () => {
  editor.view.dispatch(editor.view.state.tr.insert(1, schema.node('noteRef', { kind: 'footnote', id: '1' })))
  const fragment = doc.getXmlFragment(storyFragmentName('footnote:1'))
  writeFragment(doc, fragment, schema.node('doc', null, [schema.node('paragraph', null, [schema.node('inlineXml', { v: packJml(['w:footnoteRef', {}]) }), schema.text('Note')])]))
  editor.openStoryEditor('footnote:1')
  expect(storyView().dom.querySelector('[data-label]')?.getAttribute('data-label')).toBe('1')
  editor.view.dispatch(editor.view.state.tr.insert(1, schema.node('noteRef', { kind: 'footnote', id: 'other' })))
  expect(storyView().dom.querySelector('[data-label]')?.getAttribute('data-label')).toBe('2')
})

it('uses the configured note number format while editing an endnote', () => {
  editor.view.dispatch(editor.view.state.tr.insert(1, schema.node('noteRef', { kind: 'endnote', id: '1' })))
  writeFragment(doc, doc.getXmlFragment(storyFragmentName('endnote:1')), schema.node('doc', null, [schema.node('paragraph', null, [schema.node('inlineXml', { v: packJml(['w:endnoteRef', {}]) }), schema.text('Note')])]))
  editor.openStoryEditor('endnote:1')
  expect(storyView().dom.querySelector('[data-label]')?.getAttribute('data-label')).toBe('i')
})

it('does not insert a delayed story picture into the body after that story closes', async () => {
  editor.openStoryEditor('header:1')
  const body = editor.view.state.doc
  let release!: (bytes: ArrayBuffer) => void
  const pending = new Promise<ArrayBuffer>((resolve) => { release = resolve })
  const file = { arrayBuffer: () => pending } as Blob
  const inserted = editor.insertImage(file)
  editor.closeStoryEditor()
  release(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer)
  expect(await inserted).toBe(false)
  expect(editor.view.state.doc.eq(body)).toBe(true)
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

/** Exercise the DOM paste handler too: programmatic pasteHTML skips the clipboard event. */
function pasteHtml(view: EditorView, html: string): void {
  let handled = false
  view.someProp('handleDOMEvents', (handlers) => { handled = handlers.paste?.(view, { clipboardData: { getData: () => html }, preventDefault: () => {} } as unknown as ClipboardEvent) ?? false })
  if (!handled) view.pasteHTML(html, new Event('paste') as ClipboardEvent)
}

/** Copy through the actual editor, while delaying the source image's asset read. */
async function delayedVmlCopy() {
  const incoming = new Y.Doc()
  const incomingAssets = new MemoryAssetStore()
  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const pkg = OoxmlPackage.read(blankDocx())
  pkg.set('word/media/picture.png', image)
  pkg.setContentType('word/media/picture.png', 'image/png')
  const id = pkg.addRelationship('word/document.xml', REL.image, 'media/picture.png')
  pkg.setXml('word/document.xml', `<w:document ${Object.entries(NEW_PART_NAMESPACES).map(([key, value]) => `${key}="${value}"`).join(' ')}><w:body><w:p><w:r><w:pict><v:shape style="width:72pt;height:72pt"><v:imagedata r:id="${id}"/></v:shape></w:pict></w:r></w:p><w:sectPr/></w:body></w:document>`)
  await docxCodec.importFile(incoming, pkg.write(), { name: 'incoming.docx', assets: incomingAssets })
  const hash = readDocxModel(incoming).body.firstChild!.firstChild!.attrs.src as string
  let release!: () => void
  const ready = new Promise<void>((resolve) => { release = resolve })
  const sourceAwareness = new Awareness(incoming)
  const sourceEditor = new DocxEditor({ container: document.createElement('div'), doc: incoming, awareness: sourceAwareness, assets: {
    put: (bytes, type) => incomingAssets.put(bytes, type),
    get: async (src) => { if (src === hash) await ready; return incomingAssets.get(src) },
  }, user: { name: 'Grace', color: '#0000ff' }, layout: 'web' })
  const slice = new Slice(sourceEditor.view.state.doc.content, 1, 1)
  sourceEditor.view.props.transformCopied!(slice, sourceEditor.view)
  const holder = document.createElement('div')
  holder.appendChild(clipboardSerializer(schema).serializeFragment(slice.content))
  return { html: holder.innerHTML, release, hash, destroy: () => { sourceEditor.destroy(); sourceAwareness.destroy(); incoming.destroy() } }
}

it('transfers a foreign VML picture before inserting it at a mapped paste selection', async () => {
  const incoming = await delayedVmlCopy()
  try {
    const tr = editor.view.state.tr.insertText('AB', 1)
    editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 2)))
    pasteHtml(editor.view, incoming.html)
    expect(editor.view.state.doc.firstChild!.childCount).toBe(1)
    // Another transaction while the source is loading must move the pending paste's bookmark.
    editor.view.dispatch(editor.view.state.tr.insertText('X', 1))
    incoming.release()
    await vi.waitFor(() => { expect(editor.view.state.doc.firstChild!.childCount).toBe(3) })
    const paragraph = editor.view.state.doc.firstChild!
    expect(paragraph.child(0).text).toBe('XA')
    expect(paragraph.child(1).type.name).toBe('drawing')
    expect(paragraph.child(2).text).toBe('B')
    expect(await assets.get(incoming.hash)).toHaveLength(8)
    const pkg = OoxmlPackage.read(await docxCodec.exportFile(doc, { name: 'pasted.docx', assets }))
    const refs = relationshipReferences(elementToJml(pkg.xml('word/document.xml')!.documentElement!))
    for (const ref of refs) {
      const rel = pkg.relationships('word/document.xml').find((rel) => rel.id === ref.id)!
      expect(pkg.has(resolveTarget('word/document.xml', rel.target))).toBe(true)
    }
  } finally { incoming.destroy() }
})

it('cancels a delayed paste when its story editor closes', async () => {
  const incoming = await delayedVmlCopy()
  try {
    editor.openStoryEditor('header:1')
    const view = storyView()
    pasteHtml(view, incoming.html)
    editor.closeStoryEditor()
    incoming.release()
    // Let asset reads and the pending copy settle, including a possible erroneous paste.
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(editor.view.state.doc.textContent).toBe('')
    expect(fragmentToNode(doc.getXmlFragment(storyFragmentName('header:1'))).textContent).toBe('Original')
    expect(fragmentToNode(doc.getXmlFragment(storyFragmentName('header:1'))).firstChild!.childCount).toBe(1)
  } finally { incoming.destroy() }
})

it.each(['header', 'footer', 'footnote', 'endnote'])('imports foreign numbering into a %s in the content undo step', (kind) => {
  const numbering = new Map([
    ['num:2', packJml(['w:num', { 'w:numId': '2' }, ['w:abstractNumId', { 'w:val': '4' }]])],
    ['abstract:4', packJml(['w:abstractNum', { 'w:abstractNumId': '4' }, ['w:lvl', { 'w:ilvl': '0' }, ['w:start', { 'w:val': '7' }], ['w:numFmt', { 'w:val': 'decimal' }], ['w:lvlText', { 'w:val': '%1.' }]]])],
  ])
  const numPr = packJml(['w:numPr', {}, ['w:numId', { 'w:val': '2' }]])
  const slice = new Slice(Fragment.from(schema.node('paragraph', { numPr }, schema.text('Item'))), 1, 1)
  rememberCopy(slice, 'foreign:body', numbering)
  const holder = document.createElement('div')
  holder.appendChild(clipboardSerializer(schema).serializeFragment(slice.content))
  editor.openStoryEditor(`${kind}:1`)
  const view = storyView()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9)))
  const before = view.state.doc
  pasteHtml(view, holder.innerHTML)
  expect(view.state.doc.textContent).toBe('Item')
  expect(view.state.doc.firstChild!.attrs.numPr).not.toBe(numPr)
  expect(doc.getMap('numbering').size).toBe(2)
  expect(view.dom.querySelector('[data-label]')?.getAttribute('data-label')).toBe('7.')
  editor.undo()
  expect(view.state.doc.eq(before)).toBe(true)
  expect(doc.getMap('numbering').size).toBe(0)
  editor.redo()
  expect(view.state.doc.textContent).toBe('Item')
  expect(doc.getMap('numbering').size).toBe(2)
})

it.each(['editing', 'suggesting'] as const)('takes open pasted paragraph properties only when replacing all target content in %s', (mode) => {
  const attrs = {
    pStyle: 'Heading1', numPr: packJml(['w:numPr', {}, ['w:numId', { 'w:val': '2' }]]),
    jc: packJml(['w:jc', { 'w:val': 'center' }]), ind: packJml(['w:ind', { 'w:left': '720' }]),
    spacing: packJml(['w:spacing', { 'w:after': '240' }]), keepNext: packJml(['w:keepNext', {}]),
  }
  const sectPr = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'continuous' }]])
  const markRPr = packJml(['w:rPr', {}, ['w:b', {}]])
  for (const text of ['', 'REPLACE', 'KEEP']) {
    editor.setMode('editing')
    editor.view.dispatch(editor.view.state.tr.replaceWith(0, editor.view.state.doc.content.size,
      schema.node('paragraph', { sectPr, markRPr }, text ? schema.text(text) : undefined)))
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, text === 'KEEP' ? 2 : 1 + text.length)))
    editor.setMode(mode)
    const slice = new Slice(Fragment.from([
      schema.node('paragraph', attrs, schema.text('Alpha')),
      schema.node('paragraph', attrs, schema.text('Beta')),
    ]), 1, 1)
    rememberCopy(slice, `${doc.guid}:body`)
    const holder = document.createElement('div')
    holder.appendChild(clipboardSerializer(schema).serializeFragment(slice.content))
    pasteHtml(editor.view, holder.innerHTML)
    if (text === 'KEEP') expect(editor.view.state.doc.firstChild!.attrs.numPr).toBeNull()
    else expect(editor.view.state.doc.firstChild!.attrs).toMatchObject(attrs)
    expect(editor.view.state.doc.lastChild!.attrs).toMatchObject({ sectPr, markRPr })
    if (mode === 'suggesting') {
      editor.rejectAll()
      expect(editor.view.state.doc.childCount).toBe(1)
      expect(editor.view.state.doc.textContent).toBe(text)
      expect(editor.view.state.doc.firstChild!.attrs).toMatchObject({ sectPr, markRPr, numPr: null })
      expect(editor.revisions()).toEqual([])
    }
  }
})

it.each(['editing', 'suggesting'] as const)('keeps the first HTML list item when replacing a paragraph in %s', (mode) => {
  editor.view.dispatch(editor.view.state.tr.insertText('REPLACE', 1))
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 8)))
  editor.setMode(mode)
  pasteHtml(editor.view, '<ol><li style="text-align:center">Alpha</li><li>Beta</li></ol>')
  expect(Array.from(editor.view.dom.querySelectorAll('[data-label]'), (node) => node.getAttribute('data-label'))).toEqual(['1.', '2.'])
  expect(editor.view.state.doc.firstChild!.attrs.jc).toBe(packJml(['w:jc', { 'w:val': 'center' }]))
  if (mode === 'suggesting') editor.acceptAll()
  expect(editor.view.state.doc.textContent).toBe('AlphaBeta')
  expect(editor.revisions()).toEqual([])
})
