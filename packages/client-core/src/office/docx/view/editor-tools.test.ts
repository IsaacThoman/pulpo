// @vitest-environment jsdom
import { existsSync, statSync } from 'node:fs'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { OoxmlPackage, resolveTarget } from '../../ooxml/package.js'
import { docxCodec } from '../codec.js'
import { elementToJml, packJml, unpackJml, type JmlElement } from '../jsonml.js'
import { MemoryAssetStore } from '../memory-assets.js'
import { fragmentToNode, readDocxModel, storyFragmentName } from '../model.js'
import { CONTENT_TYPE } from '../names.js'
import { relationshipReferences } from '../relationships.js'
import { docxSchema, inlineMarks } from '../schema.js'
import { addressBefore, curlyQuote, dashBefore, listMarker } from './autoformat.js'
import { DocxEditor, type DocxRefusedImage } from './editor.js'

const schema = docxSchema()
let assets: MemoryAssetStore
let doc: Y.Doc
let awareness: Awareness
let editor: DocxEditor
const others: { editor: DocxEditor; awareness: Awareness; doc: Y.Doc }[] = []
const storyView = (target = editor) => (target as unknown as { storyEditor: { view: EditorView } | null }).storyEditor?.view

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

beforeEach(async () => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  // jsdom has neither hit testing nor Blob.arrayBuffer.
  document.elementFromPoint ??= () => null
  Blob.prototype.arrayBuffer ??= function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(this)
    })
  }
  doc = new Y.Doc()
  assets = new MemoryAssetStore()
  await docxCodec.createEmpty(doc, { name: 'a.docx', assets })
  awareness = new Awareness(doc)
  editor = new DocxEditor({ container: document.body, doc, awareness, assets, user: { name: 'Ada', color: '#ff0000' }, layout: 'web' })
})

afterEach(() => {
  for (const other of others.splice(0)) {
    other.editor.destroy()
    other.awareness.destroy()
    other.doc.destroy()
  }
  editor.destroy()
  awareness.destroy()
  doc.destroy()
  vi.unstubAllGlobals()
})

function setBody(view: EditorView, nodes: ProseMirrorNode[], cursor?: number) {
  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, nodes)
  if (cursor !== undefined) tr.setSelection(TextSelection.create(tr.doc, cursor))
  view.dispatch(tr)
}

const p = (text = '', attrs: Record<string, unknown> | null = null, marks: ReturnType<typeof schema.mark>[] = []) => schema.node('paragraph', attrs, text ? schema.text(text, marks) : undefined)

function press(view: EditorView, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

/** Types through ProseMirror's text input path, as the browser's DOM changes reach it. */
function type(view: EditorView, text: string) {
  for (const char of text) {
    const { from, to } = view.state.selection
    const fallback = () => view.state.tr.insertText(char, from, to)
    if (!view.someProp('handleTextInput', (handle) => handle(view, from, to, char, fallback))) view.dispatch(fallback())
  }
}

const firstText = () => editor.view.state.doc.firstChild!.textContent

/** Runs the editor's own DOM handler for an event (later plugins without one must not hide its result). */
function domEvent(view: EditorView, name: 'paste' | 'drop', event: object): boolean {
  let handled = false
  view.someProp('handleDOMEvents', (handlers) => {
    const handler = handlers[name] as ((view: EditorView, event: Event) => boolean | void) | undefined
    if (!handler) return false
    handled = handler(view, event as Event) === true
    return true
  })
  return handled
}

async function exportedXml(part = 'word/document.xml') {
  const pkg = OoxmlPackage.read(await docxCodec.exportFile(doc, { name: 'a.docx', assets }))
  return { pkg, xml: pkg.text(part) ?? '' }
}

function assertResolved(pkg: OoxmlPackage, path: string) {
  const xml = pkg.xml(path)?.documentElement
  if (xml) for (const ref of relationshipReferences(elementToJml(xml))) expect(pkg.relationships(path).some((rel) => rel.id === ref.id), `${path}: ${ref.id}`).toBe(true)
  for (const rel of pkg.relationships(path)) if (rel.targetMode !== 'External') expect(pkg.has(resolveTarget(path, rel.target)), `${path} -> ${rel.target}`).toBe(true)
}

describe('keys', () => {
  it('breaks a line with Shift+Enter inside the paragraph and its list item, and exports w:br', async () => {
    setBody(editor.view, [p('Line one')], 9)
    expect(press(editor.view, { key: 'Enter', shiftKey: true })).toBe(true)
    type(editor.view, 'Line two')
    const paragraph = editor.view.state.doc.firstChild!
    expect(editor.view.state.doc.childCount).toBe(1)
    expect(paragraph.child(1).type.name).toBe('break')
    expect(paragraph.child(1).attrs.type).toBe('textWrapping')
    expect(paragraph.textContent).toBe('Line oneLine two')
    const { xml } = await exportedXml()
    expect(xml).toMatch(/<w:p>(?:(?!<\/w:p>).)*Line one(?:(?!<\/w:p>).)*<w:br\/>(?:(?!<\/w:p>).)*Line two/)
    expect(editor.toggleList('decimal')).toBe(true)
    const numPr = editor.view.state.doc.firstChild!.attrs.numPr
    press(editor.view, { key: 'Enter', shiftKey: true })
    expect(editor.view.state.doc.childCount).toBe(1)
    expect(editor.view.state.doc.firstChild!.attrs.numPr).toBe(numPr)
  })

  it('adds a row with Tab in the last table cell and keeps the focus keys in the document', () => {
    setBody(editor.view, [p('Before')], 1)
    editor.insertTable(1, 2)
    const table = () => editor.view.state.doc.child(1)
    expect(press(editor.view, { key: 'Tab' })).toBe(true)
    expect(press(editor.view, { key: 'Tab' })).toBe(true)
    expect(table().childCount).toBe(2)
    type(editor.view, 'New row')
    expect(table().child(1).child(0).textContent).toBe('New row')
    // Shift+Tab in the first cell stays in the table.
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1 + 7 + 4)))
    expect(press(editor.view, { key: 'Tab', shiftKey: true })).toBe(true)
    // In a plain paragraph Shift+Tab is kept, and outdents an indented one.
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2)))
    expect(press(editor.view, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(editor.indent()).toBe(true)
    expect(editor.paragraphFormat()!.indent.left).toBe(36)
    expect(press(editor.view, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(editor.paragraphFormat()!.indent.left).toBe(0)
    editor.setReadOnly(true)
    expect(press(editor.view, { key: 'Tab' })).toBe(false)
  })

  it('tracks the row Tab adds while suggesting', () => {
    setBody(editor.view, [p('Before')], 1)
    editor.insertTable(1, 1)
    editor.setMode('suggesting')
    expect(press(editor.view, { key: 'Tab' })).toBe(true)
    expect(editor.view.state.doc.child(1).childCount).toBe(2)
    expect(editor.revisions().map((revision) => revision.kind)).toContain('rowInsert')
  })

  it('toggles alignment back to left like Word and always takes the alignment keys while editable', () => {
    setBody(editor.view, [p('Text')], 2)
    expect(press(editor.view, { key: 'e', ctrlKey: true })).toBe(true)
    expect(editor.state().alignment).toBe('center')
    expect(press(editor.view, { key: 'e', ctrlKey: true })).toBe(true)
    expect(editor.state().alignment).toBe('left')
    expect(press(editor.view, { key: 'j', ctrlKey: true })).toBe(true)
    expect(press(editor.view, { key: 'j', ctrlKey: true })).toBe(true)
    expect(editor.state().alignment).toBe('left')
    expect(press(editor.view, { key: 'l', ctrlKey: true })).toBe(true)
    expect(editor.state().alignment).toBe('left')
    editor.setReadOnly(true)
    expect(press(editor.view, { key: 'j', ctrlKey: true })).toBe(false)
  })

  it('keeps Mod-K in an editable document even when links are unavailable', () => {
    const requests: string[] = []
    editor.on('request', (request) => requests.push(request))
    setBody(editor.view, [p('Text')], 2)
    expect(press(editor.view, { key: 'k', ctrlKey: true })).toBe(true)
    editor.setMode('suggesting')
    expect(press(editor.view, { key: 'k', ctrlKey: true })).toBe(true)
    expect(requests).toEqual(['link'])
  })

  it('applies headings by built-in name, adds missing built-ins, and keeps the style with Ctrl+Space', async () => {
    doc.getMap('styles').set('style:berschrift1', packJml(['w:style', { 'w:type': 'paragraph', 'w:styleId': 'berschrift1' }, ['w:name', { 'w:val': 'heading 1' }], ['w:pPr', {}, ['w:outlineLvl', { 'w:val': '0' }]]]))
    doc.getMap('styles').delete('style:Heading1')
    setBody(editor.view, [p('Title'), p('Fifth')], 2)
    expect(press(editor.view, { key: '1', ctrlKey: true, altKey: true })).toBe(true)
    expect(editor.view.state.doc.firstChild!.attrs.pStyle).toBe('berschrift1')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 9)))
    expect(doc.getMap('styles').has('style:Heading5')).toBe(false)
    expect(press(editor.view, { key: '5', ctrlKey: true, altKey: true })).toBe(true)
    expect(editor.view.state.doc.child(1).attrs.pStyle).toBe('Heading5')
    expect(doc.getMap('styles').has('style:Heading5')).toBe(true)
    expect(editor.outline().map((entry) => entry.text)).toEqual(['Title', 'Fifth'])
    expect(press(editor.view, { key: '0', ctrlKey: true, altKey: true })).toBe(true)
    expect(editor.view.state.doc.child(1).attrs.pStyle).toBe('Normal')
    const { xml } = await exportedXml('word/styles.xml')
    expect(xml).toContain('w:styleId="Heading5"')
    // Ctrl+Space clears bold, not the heading.
    setBody(editor.view, [p('Bold heading', { pStyle: 'berschrift1' }, [schema.mark('b', { v: packJml(['w:b', {}]) })])])
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 13)))
    expect(press(editor.view, { key: ' ', ctrlKey: true })).toBe(true)
    expect(editor.view.state.doc.firstChild!.attrs.pStyle).toBe('berschrift1')
    expect(editor.state().bold).toBe(false)
  })
})

describe('autoformat', () => {
  it('recognises list markers, quotes, dashes, and addresses', () => {
    expect(listMarker('1.')).toEqual({ kind: 'decimal', format: 'decimal', start: 1, suffix: '.' })
    expect(listMarker('4)')).toEqual({ kind: 'decimal', format: 'decimal', start: 4, suffix: ')' })
    expect(listMarker('a.')).toEqual({ kind: 'decimal', format: 'lowerLetter', start: 1, suffix: '.' })
    expect(listMarker('C)')).toEqual({ kind: 'decimal', format: 'upperLetter', start: 3, suffix: ')' })
    expect(listMarker('iv.')).toEqual({ kind: 'decimal', format: 'lowerRoman', start: 4, suffix: '.' })
    expect(listMarker('i.')).toEqual({ kind: 'decimal', format: 'lowerRoman', start: 1, suffix: '.' })
    expect(listMarker('-')).toEqual({ kind: 'bullet' })
    expect(listMarker('*')).toEqual({ kind: 'bullet' })
    for (const text of ['1', '0.', 'ab.', 'iiii.', 'Hi.', '1.2.', '']) expect(listMarker(text)).toBeNull()
    expect(curlyQuote('"', '')).toBe('“')
    expect(curlyQuote('"', 'i')).toBe('”')
    expect(curlyQuote("'", 'n')).toBe('’')
    expect(curlyQuote("'", ' ')).toBe('‘')
    expect(dashBefore('well--known')).toEqual({ from: 4, to: 6, dash: '—' })
    expect(dashBefore('this - that')).toEqual({ from: 5, to: 6, dash: '–' })
    expect(dashBefore('this -- that')).toEqual({ from: 5, to: 7, dash: '–' })
    expect(dashBefore('-- that')).toBeNull()
    expect(addressBefore('see https://a.b/c.')).toEqual({ from: 4, to: 17, href: 'https://a.b/c' })
    expect(addressBefore('(www.example.com)')).toEqual({ from: 1, to: 16, href: 'https://www.example.com' })
    expect(addressBefore('mail ada@example.org')).toEqual({ from: 5, to: 20, href: 'mailto:ada@example.org' })
    expect(addressBefore('https://')).toBeNull()
    expect(addressBefore('www.example')).toBeNull()
  })

  it('starts a numbered list from "1. " in one undo step that Backspace takes back', () => {
    setBody(editor.view, [p()], 1)
    const numbering = doc.getMap('numbering').size
    type(editor.view, '1. ')
    let paragraph = editor.view.state.doc.firstChild!
    expect(paragraph.textContent).toBe('')
    expect(paragraph.attrs.numPr).toBeTruthy()
    expect(editor.state().list).toBe('decimal')
    expect(doc.getMap('numbering').size).toBe(numbering + 2)
    expect(press(editor.view, { key: 'Backspace' })).toBe(true)
    paragraph = editor.view.state.doc.firstChild!
    expect(paragraph.textContent).toBe('1. ')
    expect(paragraph.attrs.numPr).toBeNull()
    expect(doc.getMap('numbering').size).toBe(numbering)
    // The cursor is back after the marker, so typing goes on from there.
    expect(editor.view.state.selection.from).toBe(4)
    // Ctrl+Z right after a conversion does the same.
    setBody(editor.view, [p()], 1)
    type(editor.view, '* ')
    expect(editor.state().list).toBe('bullet')
    expect(press(editor.view, { key: 'z', ctrlKey: true })).toBe(true)
    expect(firstText()).toBe('* ')
    expect(editor.view.state.selection.from).toBe(3)
    // Undo after a conversion gives the literal text back too.
    setBody(editor.view, [p()], 1)
    type(editor.view, '- ')
    expect(editor.state().list).toBe('bullet')
    type(editor.view, 'Item')
    expect(firstText()).toBe('Item')
    editor.undo()
    editor.undo()
    expect(firstText()).toBe('- ')
    expect(editor.state().list).toBeNull()
  })

  it('numbers lists from letter and roman markers with their own format', () => {
    setBody(editor.view, [p()], 1)
    type(editor.view, 'b) ')
    const numId = unpackJml<JmlElement>(editor.view.state.doc.firstChild!.attrs.numPr)!
    const id = (numId.slice(2) as JmlElement[]).find((child) => child[0] === 'w:numId')![1]['w:val']!
    const num = unpackJml<JmlElement>(doc.getMap<string>('numbering').get(`num:${id}`))!
    const abstractId = (num.slice(2) as JmlElement[])[0]![1]['w:val']
    const level = (unpackJml<JmlElement>(doc.getMap<string>('numbering').get(`abstract:${abstractId}`))!.slice(2) as JmlElement[]).find((child) => child[0] === 'w:lvl')!
    const values = Object.fromEntries((level.slice(2) as JmlElement[]).map((child) => [child[0], child[1]['w:val']]))
    expect(values).toMatchObject({ 'w:start': '2', 'w:numFmt': 'lowerLetter', 'w:lvlText': '%1)' })
  })

  it('leaves headings, existing lists, and suggestions alone', () => {
    setBody(editor.view, [p('', { pStyle: 'Heading1' })], 1)
    type(editor.view, '1. ')
    expect(firstText()).toBe('1. ')
    setBody(editor.view, [p()], 1)
    editor.setMode('suggesting')
    type(editor.view, '1. see www.example.com ')
    expect(firstText()).toBe('1. see www.example.com ')
    expect(editor.view.state.doc.firstChild!.attrs.numPr).toBeNull()
    expect(editor.view.state.doc.rangeHasMark(0, editor.view.state.doc.content.size, schema.marks.link!)).toBe(false)
  })

  it('curls quotes, makes dashes, and links addresses as separate undo steps', () => {
    setBody(editor.view, [p()], 1)
    type(editor.view, 'He said "don\'t" -- see www.example.com ')
    expect(firstText()).toBe('He said “don’t” – see www.example.com ')
    const linked: string[] = []
    editor.view.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'link' && mark.attrs.href === 'https://www.example.com')) linked.push(node.text!)
      return true
    })
    expect(linked.join('')).toBe('www.example.com')
    editor.undo()
    expect(editor.view.state.doc.rangeHasMark(0, editor.view.state.doc.content.size, schema.marks.link!)).toBe(false)
    expect(firstText()).toBe('He said “don’t” – see www.example.com ')
    setBody(editor.view, [p()], 1)
    type(editor.view, 'well--known ')
    expect(firstText()).toBe('well—known ')
    expect(press(editor.view, { key: 'z', ctrlKey: true })).toBe(true)
    expect(firstText()).toBe('well--known ')
    expect(editor.view.state.selection.from).toBe(13)
    // Backspace after a quote just deletes it.
    setBody(editor.view, [p()], 1)
    type(editor.view, 'a"')
    press(editor.view, { key: 'Backspace' })
    expect(firstText()).toBe('a”')
  })

  it('tracks curled quotes and dashes as plain insertions while suggesting', () => {
    setBody(editor.view, [p('Start')], 6)
    editor.setMode('suggesting')
    type(editor.view, ' "a" b--c ')
    expect(firstText()).toBe('Start “a” b—c ')
    expect(editor.revisions().map((revision) => [revision.kind, revision.text])).toEqual([['insert', ' “a” b—c ']])
    // Over a selection, the quote replaces it and is curled.
    editor.setMode('editing')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 6)))
    type(editor.view, '"')
    expect(firstText().startsWith('“ ')).toBe(true)
    // A quote typed over a selection lands after the suggested deletion, and that one is curled.
    setBody(editor.view, [p('Hello world')], 1)
    editor.setMode('suggesting')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 6)))
    type(editor.view, '"')
    expect(firstText()).toBe('Hello“ world')
    expect(editor.revisions().map((revision) => [revision.kind, revision.text])).toEqual([['delete', 'Hello'], ['insert', '“']])
    expect(editor.undo()).toBe(true)
    expect(firstText()).toBe('Hello" world')
    expect(editor.view.state.selection.from).toBe(7)
  })

  it('links an address before Enter splits the paragraph', () => {
    setBody(editor.view, [p()], 1)
    type(editor.view, 'Mail ada@example.org')
    press(editor.view, { key: 'Enter' })
    expect(editor.view.state.doc.childCount).toBe(2)
    expect(editor.view.state.doc.firstChild!.lastChild!.marks.find((mark) => mark.type.name === 'link')?.attrs.href).toBe('mailto:ada@example.org')
  })

  it('does nothing when turned off', () => {
    editor.setAutoformat(false)
    setBody(editor.view, [p()], 1)
    type(editor.view, '1. "a" b--c www.example.com ')
    expect(firstText()).toBe('1. "a" b--c www.example.com ')
    editor.setAutoformat({ quotes: false })
    expect(editor.autoformat).toEqual({ lists: true, quotes: false, dashes: true, links: true })
    setBody(editor.view, [p()], 1)
    type(editor.view, '"a" ')
    expect(firstText()).toBe('"a" ')
  })
})

describe('pictures from the clipboard and drops', () => {
  it('inserts pasted and dropped picture files, and reports types Word cannot show', async () => {
    const refused: DocxRefusedImage[] = []
    editor.on('imageRefused', (image) => refused.push(image))
    setBody(editor.view, [p('AB')], 2)
    const transfer = (files: File[], html = '') => ({ files, getData: (type: string) => (type === 'text/html' ? html : '') })
    const pictures = () => {
      let count = 0
      editor.view.state.doc.descendants((node) => { if (node.type.name === 'drawing') count++ })
      return count
    }
    expect(domEvent(editor.view, 'paste', { clipboardData: transfer([new File([PNG], 'shot.png', { type: 'image/png' })], '<img src="blob:x">'), preventDefault: () => {} })).toBe(true)
    await vi.waitFor(() => expect(pictures()).toBe(1))
    expect(editor.view.state.doc.firstChild!.child(1).type.name).toBe('drawing')
    expect(domEvent(editor.view, 'drop', { dataTransfer: transfer([new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), new File([PNG], 'two.png', { type: 'image/png' })]), clientX: 0, clientY: 0, preventDefault: () => {} })).toBe(true)
    await vi.waitFor(() => expect(pictures()).toBe(2))
    expect(refused).toEqual([{ name: 'logo.svg', type: 'image/svg+xml', reason: 'unsupported' }])
    const { pkg } = await exportedXml()
    expect(pkg.paths().filter((path) => path.startsWith('word/media/'))).toHaveLength(1)
  })

  it('leaves text pastes with pictures to the HTML path', () => {
    setBody(editor.view, [p('AB')], 2)
    expect(domEvent(editor.view, 'paste', { clipboardData: { files: [new File([PNG], 'x.png', { type: 'image/png' })], getData: (type: string) => (type === 'text/html' ? '<p>Words <img src="x"></p>' : '') }, preventDefault: () => {} })).toBe(false)
  })
})

describe('headers, footers, and page numbers', () => {
  beforeEach(() => {
    editor.setLayout('print')
    editor.relayout()
  })

  it('creates a header part the export writes, and edits it in place', async () => {
    expect(editor.headerFooter().header.default).toBeUndefined()
    const id = editor.addHeaderFooter('header')!
    expect(id).toMatch(/^header:word\/header\d+\.xml$/)
    expect(editor.editingStory).toBe(id)
    expect(editor.state().editingStory).toBe(id)
    expect(editor.headerFooter().header.default).toBe(id)
    type(storyView()!, 'Running head')
    expect(fragmentToNode(doc.getXmlFragment(storyFragmentName(id))).textContent).toBe('Running head')
    expect(fragmentToNode(doc.getXmlFragment(storyFragmentName(id))).firstChild!.attrs.pStyle).toBe('Header')
    // Asking again opens the same header.
    editor.closeStoryEditor()
    expect(editor.addHeaderFooter('header')).toBe(id)
    const part = id.slice('header:'.length)
    const { pkg, xml } = await exportedXml()
    expect(pkg.contentType(part)).toBe(CONTENT_TYPE.header)
    expect(pkg.text(part)).toContain('Running head')
    expect(xml).toMatch(/<w:headerReference w:type="default" r:id="rId\d+"\/>/)
    assertResolved(pkg, 'word/document.xml')
    const reimported = new Y.Doc()
    await docxCodec.importFile(reimported, pkg.write(), { name: 'b.docx', assets })
    expect([...readDocxModel(reimported).stories.values()].filter((story) => story.meta.kind === 'header').map((story) => story.doc.textContent)).toEqual(['Running head'])
    reimported.destroy()
  })

  it('inserts page numbers into a new footer and renders them per page', async () => {
    editor.view.dispatch(editor.view.state.tr.replaceWith(0, editor.view.state.doc.content.size, [p('One'), p('Two', { pageBreakBefore: packJml(['w:pageBreakBefore', {}]) })]))
    editor.relayout()
    expect(editor.insertPageNumber({ kind: 'footer', align: 'right', withTotal: true })).toBe(true)
    const id = editor.editingStory!
    expect(id).toMatch(/^footer:/)
    const footer = fragmentToNode(doc.getXmlFragment(storyFragmentName(id)))
    expect(footer.childCount).toBe(1)
    expect(footer.firstChild!.attrs.jc).toContain('right')
    const fields: string[] = []
    footer.descendants((node) => {
      const field = inlineMarks(node).find((mark) => mark.type.name === 'fldSimple')
      if (field) fields.push(unpackJml<JmlElement>(field.attrs.v as string)![1]['w:instr']!.trim())
    })
    expect(fields).toEqual(['PAGE', 'NUMPAGES'])
    editor.closeStoryEditor()
    editor.relayout()
    expect([...document.querySelectorAll(`[data-story="${id}"]`)].map((element) => element.textContent)).toEqual(['Page 1 of 2', 'Page 2 of 2'])
    const { pkg } = await exportedXml()
    expect(pkg.text(id.slice('footer:'.length))).toMatch(/<w:fldSimple w:instr=" PAGE ">/)
  })

  it('makes a first-page header with its section option, and removes headers', () => {
    const first = editor.addHeaderFooter('header', 'first')!
    expect(editor.headerFooter().differentFirstPage).toBe(true)
    expect(String(doc.getMap('docx').get('sectPr'))).toContain('w:titlePg')
    expect(editor.headerFooter().header.first).toBe(first)
    expect(editor.removeHeaderFooter('header', 'first')).toBe(true)
    expect(editor.headerFooter().header.first).toBeUndefined()
    expect(doc.getMap('stories').has(first)).toBe(false)
    expect(String(doc.getMap('docx').get('sectPr'))).not.toContain('headerReference')
  })

  it('refuses while suggesting and in web layout', () => {
    const stories = doc.getMap('stories').size
    editor.setMode('suggesting')
    expect(editor.addHeaderFooter('header')).toBeNull()
    expect(editor.insertPageNumber({ kind: 'footer' })).toBe(false)
    editor.setMode('editing')
    editor.setLayout('web')
    expect(editor.addHeaderFooter('header')).toBeNull()
    expect(doc.getMap('stories').size).toBe(stories)
    expect(String(doc.getMap('docx').get('sectPr'))).not.toContain('Reference')
  })

  it('converges when two collaborators add headers at once', () => {
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const peerAwareness = new Awareness(peer)
    const other = new DocxEditor({ container: document.createElement('div'), doc: peer, awareness: peerAwareness, assets, user: { name: 'Grace', color: '#0000ff' }, layout: 'print' })
    others.push({ editor: other, awareness: peerAwareness, doc: peer })
    other.relayout()
    const mine = editor.addHeaderFooter('header')
    const theirs = other.addHeaderFooter('header')
    expect(mine).not.toBe(theirs)
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
    for (const replica of [doc, peer]) {
      const sectPr = unpackJml<JmlElement>(replica.getMap<string>('docx').get('sectPr'))!
      const references = (sectPr.slice(2) as JmlElement[]).filter((child) => child[0] === 'w:headerReference')
      expect(references).toHaveLength(1)
      const rel = JSON.parse(replica.getMap<string>('rels').get(references[0]![1]['r:id']!)!) as { target: string }
      expect(replica.getMap('stories').has(`header:${resolveTarget('word/document.xml', rel.target)}`)).toBe(true)
    }
    expect(doc.getMap('docx').get('sectPr')).toBe(peer.getMap('docx').get('sectPr'))
    // A collaborator then opens the header that won rather than making another.
    editor.closeStoryEditor()
    other.closeStoryEditor()
    const winner = editor.headerFooter().header.default
    expect(other.headerFooter().header.default).toBe(winner)
    const stories = doc.getMap('stories').size
    expect(other.addHeaderFooter('header')).toBe(winner)
    expect(peer.getMap('stories').size).toBe(stories)
  })
})

describe('page setup', () => {
  it('turns pages landscape in one undo step and keeps other section settings', async () => {
    const before = String(doc.getMap('docx').get('sectPr'))
    expect(editor.pageSetup()).toMatchObject({ width: 612, height: 792, orientation: 'portrait', margins: { top: 72, left: 72, header: 36, gutter: 0 }, section: 0, sections: 1 })
    expect(editor.setPageSetup({ orientation: 'landscape', margins: { left: 54, right: 54 } })).toBe(true)
    expect(editor.pageSetup()).toMatchObject({ width: 792, height: 612, orientation: 'landscape', margins: { left: 54, right: 54, top: 72 } })
    const sectPr = String(doc.getMap('docx').get('sectPr'))
    expect(sectPr).toContain('"w:orient":"landscape"')
    expect(sectPr).toContain('w:docGrid')
    const { pkg, xml } = await exportedXml()
    expect(xml).toContain('<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>')
    expect(xml).toMatch(/<w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="720" w:footer="720" w:gutter="0"\/>/)
    // Imported again, the page reads the same.
    const reimported = new Y.Doc()
    await docxCodec.importFile(reimported, pkg.write(), { name: 'b.docx', assets })
    const readerAwareness = new Awareness(reimported)
    const reader = new DocxEditor({ container: document.createElement('div'), doc: reimported, awareness: readerAwareness, assets, user: { name: 'Grace', color: '#00f' }, layout: 'web' })
    others.push({ editor: reader, awareness: readerAwareness, doc: reimported })
    expect(reader.pageSetup()).toMatchObject({ width: 792, height: 612, orientation: 'landscape', margins: { left: 54, right: 54 } })
    expect(editor.undo()).toBe(true)
    expect(String(doc.getMap('docx').get('sectPr'))).toBe(before)
    expect(editor.redo()).toBe(true)
    expect(editor.pageSetup().orientation).toBe('landscape')
  })

  it('refuses page setups without room for text, and while suggesting', () => {
    const before = doc.getMap('docx').get('sectPr')
    expect(editor.setPageSetup({ margins: { left: 300, right: 300 } })).toBe(false)
    expect(editor.setPageSetup({ width: 0 })).toBe(false)
    editor.setMode('suggesting')
    expect(editor.setPageSetup({ orientation: 'landscape' })).toBe(false)
    expect(doc.getMap('docx').get('sectPr')).toBe(before)
  })

  it('changes every section or only the one at the cursor', () => {
    const first = packJml(['w:sectPr', {}, ['w:pgSz', { 'w:w': '12240', 'w:h': '15840', 'w:code': '1' }], ['w:type', { 'w:val': 'nextPage' }]])
    setBody(editor.view, [p('First', { sectPr: first }), p('Second')], 2)
    expect(editor.pageSetup().sections).toBe(2)
    expect(editor.setPageSetup({ width: 595.3, height: 841.9 }, 'section')).toBe(true)
    expect(editor.view.state.doc.firstChild!.attrs.sectPr).toContain('"w:w":"11906"')
    expect(editor.view.state.doc.firstChild!.attrs.sectPr).toContain('"w:code":"1"')
    expect(String(doc.getMap('docx').get('sectPr'))).toContain('"w:w":"12240"')
    expect(editor.setPageSetup({ orientation: 'landscape' })).toBe(true)
    expect(readDocxModel(doc).body.firstChild!.attrs.sectPr).toContain('"w:orient":"landscape"')
    expect(String(doc.getMap('docx').get('sectPr'))).toContain('"w:orient":"landscape"')
  })

  it('shares page setup with a collaborator', () => {
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const peerAwareness = new Awareness(peer)
    const other = new DocxEditor({ container: document.createElement('div'), doc: peer, awareness: peerAwareness, assets, user: { name: 'Grace', color: '#0000ff' }, layout: 'web' })
    others.push({ editor: other, awareness: peerAwareness, doc: peer })
    doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(peer, update, 'remote') })
    expect(editor.setPageSetup({ orientation: 'landscape' })).toBe(true)
    expect(other.pageSetup().orientation).toBe('landscape')
    // Grace's undo stack does not hold Ada's change.
    other.undo()
    expect(other.pageSetup().orientation).toBe('landscape')
  })
})

describe('format painter', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  })

  const bold = schema.mark('b', { v: packJml(['w:b', {}]) })
  const isBold = (from: number, to: number) => editor.view.state.doc.rangeHasMark(from, to, schema.marks.b!)

  it('paints the next mouse selection, then turns off', () => {
    setBody(editor.view, [schema.node('paragraph', null, [schema.text('Bold', [bold]), schema.text(' plain words')])], 2)
    expect(editor.formatPainter()).toBe(true)
    expect(editor.state().formatPainter).toBe(true)
    expect(document.querySelector('.docx-editor')!.classList.contains('docx-painting')).toBe(true)
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 6, 11)))
    editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    editor.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    expect(isBold(6, 11)).toBe(true)
    expect(isBold(11, 17)).toBe(false)
    expect(editor.state().formatPainter).toBe(false)
    expect(document.querySelector('.docx-painting')).toBeNull()
  })

  it('paints the word under a click, keeps painting when sticky, and stops on Escape', () => {
    setBody(editor.view, [schema.node('paragraph', null, [schema.text('Bold', [bold]), schema.text(' one two')])], 2)
    editor.formatPainter({ sticky: true })
    expect(editor.state().formatPainterSticky).toBe(true)
    for (const pos of [7, 11]) {
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, pos)))
      editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      editor.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    }
    expect(isBold(6, 9)).toBe(true)
    expect(isBold(10, 13)).toBe(true)
    expect(editor.state().formatPainter).toBe(true)
    expect(press(editor.view, { key: 'Escape' })).toBe(true)
    expect(editor.state().formatPainter).toBe(false)
  })

  it('paints a Shift+arrow selection when Shift is released', () => {
    setBody(editor.view, [schema.node('paragraph', null, [schema.text('Bold', [bold]), schema.text(' one')])], 2)
    editor.formatPainter()
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 6, 9)))
    editor.view.dom.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    expect(isBold(6, 9)).toBe(true)
    expect(editor.state().formatPainter).toBe(false)
  })
})

describe('review navigation', () => {
  it('toggles Suggesting with Ctrl+Shift+E, but not out of Viewing', () => {
    setBody(editor.view, [p('Text')], 2)
    expect(press(editor.view, { key: 'e', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(editor.mode).toBe('suggesting')
    expect(press(editor.view, { key: 'e', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(editor.mode).toBe('editing')
    editor.setMode('viewing')
    expect(press(editor.view, { key: 'e', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(editor.mode).toBe('viewing')
  })

  it('moves between suggestions and accepts the one at the cursor', () => {
    setBody(editor.view, [p('First paragraph'), p('Second paragraph')], 1)
    editor.setMode('suggesting')
    type(editor.view, 'One ')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, editor.view.state.doc.content.size - 1)))
    type(editor.view, ' two')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1)))
    expect(editor.revisions()).toHaveLength(2)
    expect(editor.state().inRevision).toBe(true)
    const next = editor.nextRevision(1)!
    expect(next.text).toBe(' two')
    expect(editor.view.state.selection.from).toBe(next.from)
    expect(editor.revisionsAt().map((revision) => revision.text)).toEqual([' two'])
    expect(editor.nextRevision(1)!.text).toBe('One ')
    expect(editor.nextRevision(-1)!.text).toBe(' two')
    expect(editor.acceptRevisionAtCaret()).toBe(true)
    expect(editor.revisions().map((revision) => revision.text)).toEqual(['One '])
    editor.nextRevision(1)
    expect(editor.rejectRevisionAtCaret()).toBe(true)
    expect(editor.revisions()).toEqual([])
    expect(editor.text()).toBe('First paragraph\nSecond paragraph two')
    expect(editor.nextRevision(1)).toBeNull()
  })
})

describe('counts, links, case, paragraph and table formats', () => {
  it('counts the selection and finds the page of the cursor', () => {
    setBody(editor.view, [p('One two three'), p('Four five')], 1)
    expect(editor.wordCount('selection').words).toBe(0)
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 5, 18)))
    expect(editor.wordCount('selection')).toMatchObject({ words: 3, paragraphs: 2 })
    expect(editor.wordCount()).toMatchObject({ words: 5, paragraphs: 2 })
    expect(editor.currentPage()).toBeUndefined()
    editor.setLayout('print')
    editor.relayout()
    expect(editor.currentPage()).toEqual({ index: 1, count: 1, number: 1 })
  })

  it('edits and removes the whole link at the cursor, across markers inside it', async () => {
    const link = schema.mark('link', { v: packJml(['w:hyperlink', { 'r:id': 'rId99', 'w:history': '1' }, '\u0000']), href: 'https://a.example' })
    const style = schema.mark('rStyle', { v: packJml(['w:rStyle', { 'w:val': 'Hyperlink' }]) })
    setBody(editor.view, [schema.node('paragraph', null, [
      schema.text('See '), schema.text('the', [link, style]), schema.node('bookmark', { edge: 'start', id: '1', name: 'here' }), schema.text(' docs', [link, style]), schema.text(' now'),
    ])], 7)
    expect(editor.linkAt()).toMatchObject({ from: 5, to: 14, href: 'https://a.example', text: 'the docs' })
    // At the link's end the cursor is still in it.
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 14)))
    expect(editor.linkAt()?.text).toBe('the docs')
    expect(editor.setLink('https://b.example')).toBe(true)
    const hrefs = new Set<string>()
    editor.view.state.doc.descendants((node) => { for (const mark of node.marks) if (mark.type.name === 'link') hrefs.add(String(mark.attrs.href)) })
    expect([...hrefs]).toEqual(['https://b.example'])
    expect(firstText()).toBe('See the docs now')
    const { xml } = await exportedXml()
    expect(xml.match(/<w:hyperlink /g)).toHaveLength(2)
    expect(editor.setLink(null)).toBe(true)
    expect(editor.view.state.doc.rangeHasMark(0, editor.view.state.doc.content.size, schema.marks.link!)).toBe(false)
    expect(editor.view.state.doc.rangeHasMark(0, editor.view.state.doc.content.size, schema.marks.rStyle!)).toBe(false)
    expect(editor.linkAt()).toBeNull()
  })

  it('replaces a plain link text when editing it', () => {
    setBody(editor.view, [p('Go '), p()], 4)
    editor.setLink('https://a.example', 'here')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 6)))
    expect(editor.setLink('#Intro', 'Introduction')).toBe(true)
    expect(firstText()).toBe('Go Introduction')
    expect(editor.linkAt()).toMatchObject({ href: null, anchor: 'Intro', text: 'Introduction' })
  })

  it('changes case across runs, keeping formatting and deletions', () => {
    const bold = schema.mark('b', { v: packJml(['w:b', {}]) })
    const del = schema.mark('del', { v: packJml(['w:del', { 'w:id': '1', 'w:author': 'X' }, '\u0000']) })
    setBody(editor.view, [schema.node('paragraph', null, [schema.text('hel'), schema.text('lo WOR', [bold]), schema.text('LD. again '), schema.text('gone', [del])])])
    const all = () => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, editor.view.state.doc.content.size - 1)))
    all()
    expect(editor.changeCase('title')).toBe(true)
    expect(firstText()).toBe('Hello World. Again gone')
    expect(editor.view.state.doc.firstChild!.child(1).marks.map((mark) => mark.type.name)).toEqual(['b'])
    all()
    editor.changeCase('sentence')
    expect(firstText()).toBe('Hello world. Again gone')
    all()
    editor.changeCase('cycle')
    expect(firstText()).toBe('HELLO WORLD. AGAIN gone')
    all()
    editor.changeCase('cycle')
    expect(firstText()).toBe('hello world. again gone')
    // The word at a cursor, in its language.
    const turkish = schema.mark('rPrRest', { v: packJml([['w:lang', { 'w:val': 'tr-TR' }]]) })
    setBody(editor.view, [schema.node('paragraph', null, [schema.text('istanbul', [turkish]), schema.text(' city')])], 3)
    editor.changeCase('upper')
    expect(firstText()).toBe('İSTANBUL city')
    expect(editor.view.state.selection.from).toBe(3)
  })

  it('reads and writes paragraph formats in one step, and draws horizontal lines', async () => {
    setBody(editor.view, [p('Text')], 2)
    expect(editor.setParagraphFormat({ indent: { firstLine: 36, left: 18 }, spacing: { before: 6, line: { exact: 18 } }, keepNext: true, alignment: 'both' })).toBe(true)
    expect(editor.paragraphFormat()).toMatchObject({ alignment: 'both', indent: { left: 18, firstLine: 36, hanging: 0 }, spacing: { before: 6, line: { exact: 18 } }, keepNext: true })
    expect(editor.state()).toMatchObject({ spaceBefore: 6 })
    editor.setParagraphFormat({ indent: { hanging: 18 } })
    expect(editor.paragraphFormat()!.indent).toMatchObject({ firstLine: 0, hanging: 18 })
    const { xml } = await exportedXml()
    expect(xml).toContain('<w:keepNext/>')
    expect(xml).toMatch(/<w:spacing [^>]*w:line="360" w:lineRule="exact"/)
    expect(xml).toContain('<w:ind w:left="360" w:hanging="360"/>')
    editor.setParagraphFormat({ keepNext: false })
    expect(editor.view.state.doc.firstChild!.attrs.keepNext).toBeNull()
    expect(editor.setLineSpacing({ atLeast: 14 })).toBe(true)
    expect(editor.paragraphFormat()!.spacing.line).toEqual({ atLeast: 14 })
    expect(editor.insertHorizontalLine()).toBe(true)
    const body = editor.view.state.doc
    expect(body.childCount).toBe(3)
    expect(body.child(1).attrs.pBdr).toContain('w:bottom')
    expect(editor.view.state.selection.$from.parent).toBe(body.child(2))
    type(editor.view, 'Below')
    expect(body.child(2).textContent).toBe('')
    expect(editor.view.state.doc.child(2).textContent).toBe('Below')
    expect((await exportedXml()).xml).toMatch(/<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"\/><\/w:pBdr>/)
    editor.undo()
    editor.undo()
    expect(editor.view.state.doc.childCount).toBe(1)
  })

  it('sets cell alignment, header rows, and table alignment, which suggestions cannot record', async () => {
    setBody(editor.view, [p('Before')], 1)
    editor.insertTable(3, 2)
    expect(editor.state().inTable).toBe(true)
    expect(editor.setCellVerticalAlign('center')).toBe(true)
    expect(editor.state().cellVerticalAlign).toBe('center')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, editor.view.state.selection.from + 4)))
    expect(editor.setHeaderRow(true)).toBe(true)
    expect(editor.state().headerRow).toBe(true)
    const rows = () => { const table = editor.view.state.doc.child(1); return [0, 1, 2].map((index) => String(table.child(index).attrs.trPr ?? '').includes('w:tblHeader')) }
    expect(rows()).toEqual([true, false, false])
    expect(editor.setTableAlignment('center')).toBe(true)
    expect(editor.tableFormat()).toEqual({ verticalAlign: 'top', headerRow: true, alignment: 'center' })
    expect(editor.selectTable('row')).toBe(true)
    const { xml } = await exportedXml()
    expect(xml).toContain('<w:vAlign w:val="center"/>')
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).toMatch(/<w:tblPr><w:tblStyle w:val="TableGrid"\/><w:tblW w:w="0" w:type="auto"\/><w:jc w:val="center"\/>/)
    editor.setMode('suggesting')
    expect(editor.setHeaderRow(false)).toBe(false)
    expect(editor.setCellVerticalAlign('bottom')).toBe(false)
    expect(editor.setTableAlignment('left')).toBe(false)
  })

  it.runIf(process.env.PULPO_DOCX_FIDELITY === '1')('writes headers, page numbers, page setup, breaks, and formats as python-docx and LibreOffice read them', { timeout: 240_000 }, async () => {
    const python = process.env.PULPO_DOCX_PYTHON ?? '/tmp/pulpo-docx-venv/bin/python'
    editor.setLayout('print')
    editor.relayout()
    setBody(editor.view, [p('Intro'), p('Indented'), p('Cells')], 6)
    press(editor.view, { key: 'Enter', shiftKey: true })
    type(editor.view, 'second line')
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, editor.view.state.doc.child(0).nodeSize + 2)))
    editor.setParagraphFormat({ indent: { firstLine: 36 }, spacing: { line: { exact: 18 } }, keepNext: true })
    editor.insertHorizontalLine()
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)))
    editor.insertTable(2, 2)
    editor.setCellVerticalAlign('center')
    editor.setHeaderRow(true)
    expect(editor.setPageSetup({ width: 595.3, height: 841.9, orientation: 'landscape', margins: { left: 54 } })).toBe(true)
    editor.addHeaderFooter('header')
    type(storyView()!, 'Running head')
    expect(editor.insertPageNumber({ kind: 'footer', align: 'center', withTotal: true })).toBe(true)
    editor.closeStoryEditor()
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { spawnSync } = await import('node:child_process')
    const work = mkdtempSync(join(tmpdir(), 'pulpo-docx-tools-'))
    const output = join(work, 'tools.docx')
    writeFileSync(output, await docxCodec.exportFile(doc, { name: 'tools.docx', assets }))
    const check = spawnSync(python, ['-I', '-c', `
import sys, zipfile, docx
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
d = docx.Document(sys.argv[1])
s = d.sections[0]
assert s.orientation == WD_ORIENT.LANDSCAPE, s.orientation
assert s.page_width == 16838 * 635 and s.page_height == 11906 * 635, (s.page_width, s.page_height)
assert s.left_margin == 1080 * 635, s.left_margin
assert [p.text for p in s.header.paragraphs] == ['Running head'], [p.text for p in s.header.paragraphs]
footer = s.footer.paragraphs[0]
assert footer.alignment == 1, footer.alignment
assert footer._p.xml.count('w:fldSimple') == 4 and ' PAGE ' in footer._p.xml and ' NUMPAGES ' in footer._p.xml, footer._p.xml
intro = d.paragraphs[0]
assert intro.text == 'Intro\\nsecond line', repr(intro.text)
indented = d.paragraphs[1]
assert indented.paragraph_format.first_line_indent == 720 * 635, indented.paragraph_format.first_line_indent
assert indented.paragraph_format.keep_with_next is True
assert indented.paragraph_format.line_spacing == 360 * 635, indented.paragraph_format.line_spacing
line = d.paragraphs[2]
assert line.text == '' and '<w:bottom w:val="single"' in line._p.xml, line._p.xml
cell = d.tables[0].cell(0, 0)
assert cell.vertical_alignment == WD_CELL_VERTICAL_ALIGNMENT.CENTER, cell.vertical_alignment
assert d.tables[0].rows[0]._tr.trPr.xml.count('w:tblHeader') == 1
print('ok')
`, output], { encoding: 'utf8', timeout: 180_000 })
    expect(check.stdout.trim(), check.stderr).toBe('ok')
    const soffice = process.env.PULPO_DOCX_SOFFICE ?? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    if (existsSync(soffice)) {
      // A profile of its own: fidelity.test.ts converts with the shared one at the same time.
      const converted = spawnSync(soffice, [`-env:UserInstallation=file://${join(work, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', work, output], { encoding: 'utf8', timeout: 180_000 })
      expect(converted.status, converted.stdout + converted.stderr).toBe(0)
      expect(statSync(join(work, 'tools.pdf')).size).toBeGreaterThan(1000)
    }
  })

  it('pastes plain text a host read from the clipboard', () => {
    setBody(editor.view, [p('AB')], 2)
    expect(editor.pasteData({ text: 'xyz', html: '<b>xyz</b>' }, { plain: true })).toBe(true)
    expect(firstText()).toBe('AxyzB')
    editor.setReadOnly(true)
    expect(editor.pasteData({ text: 'no' })).toBe(false)
  })
})
