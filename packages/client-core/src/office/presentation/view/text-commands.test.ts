// @vitest-environment jsdom
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from '../blank.js'
import { presentationCodec } from '../codec.js'
import { setShapeText, shapeFragment } from '../commands.js'
import { steppedFontSize } from '../formatting.js'
import { plainToText, type TextJSON } from '../text.js'
import { memoryAssets } from '../testing/assets.js'
import { LOCAL_ORIGIN, normalizeLink, PresentationController } from './controller.js'
import { NotesEditor } from './notes.js'
import { editorShortcut, requestShortcut, textShortcut } from './shortcuts.js'
import { InlineTextEditor } from './text-editor.js'

// ProseMirror scrolls the selection into view; jsdom has no layout, so ranges measure as empty.
const emptyRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = emptyRect

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const step of cleanup.splice(0).reverse()) step()
  document.body.replaceChildren()
})

async function open() {
  const assets = memoryAssets()
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, blankPresentation(), { name: 'deck.pptx', assets })
  const controller = new PresentationController({ doc, assets, readOnly: false, user: { name: 'Editor', color: '#123456' } })
  cleanup.push(() => { controller.destroy(); doc.destroy() })
  const slide = controller.state.slide!
  const [title, subtitle] = controller.slide(slide)!.shapes.map((shape) => shape.key) as [string, string]
  return { doc, assets, controller, slide, title, subtitle }
}

/** Opens an inline editor on a shape the way the canvas does. */
function edit(controller: PresentationController, slide: string, shape: string): InlineTextEditor {
  const layout = controller.textLayout(slide, shape)!
  const mount = document.createElement('div')
  document.body.append(mount)
  const editor = new InlineTextEditor({ mount, fragment: shapeFragment(controller.doc, slide, shape, LOCAL_ORIGIN)!, style: { context: layout.context, body: layout.body, env: layout.env }, onUndo: () => controller.undo(), onRedo: () => controller.redo(), onToggleMark: (mark) => controller.toggleMark(mark) })
  controller.setState({ shapes: [shape], editing: { slide, shape } })
  controller.activeEditor = editor
  cleanup.push(() => { controller.activeEditor = undefined; editor.destroy() })
  return editor
}

function runs(controller: PresentationController, slide: string, shape: string): NonNullable<TextJSON['content']> {
  return controller.shape(slide, shape)!.text!.content![0]!.content ?? []
}

async function exportedSlide(controller: PresentationController, assets: ReturnType<typeof memoryAssets>) {
  const bytes = await presentationCodec.exportFile(controller.doc, { name: 'deck.pptx', assets })
  const files = unzipSync(bytes)
  return { bytes, xml: strFromU8(files['ppt/slides/slide1.xml']!), rels: strFromU8(files['ppt/slides/_rels/slide1.xml.rels']!) }
}

describe('presentation text commands', () => {
  it('formats the selection of the text being edited, inserts fields, and edits links at the caret', async () => {
    const { controller, assets, slide, title } = await open()
    setShapeText(controller.doc, slide, title, plainToText('Big and small'), LOCAL_ORIGIN)
    const editor = edit(controller, slide, title)
    editor.select(1, 4)
    controller.setFontSize(13)
    editor.select(1, 14)
    // Mixed sizes step separately: 13 → 14, 60 → 66.
    controller.stepFontSize(1)
    expect(runs(controller, slide, title).map((run) => [run.text, run.marks?.find((mark) => mark.type === 'sz')?.attrs?.value])).toEqual([['Big', 1400], [' and small', 6600]])
    editor.select(9, 14)
    controller.toggleBaseline('sub')
    expect(controller.formatState().baseline).toBe('sub')
    editor.select(14, 14)
    expect(controller.setLink('mailto:team@example.com', ' (mail us)')).toBe(true)
    // At a caret inside the link, the link is edited as a whole.
    editor.select(18, 18)
    expect(controller.formatState().link).toBe('mailto:team@example.com')
    controller.setLink('https://example.org')
    expect(runs(controller, slide, title).filter((run) => run.marks?.some((mark) => mark.type === 'link')).map((run) => run.text).join('')).toBe(' (mail us)')
    editor.select(1, 1)
    expect(controller.insertField('slideNumber')).toBe(true)
    const { xml } = await exportedSlide(controller, assets)
    expect(xml).toMatch(/<a:fld id="\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}" type="slidenum">(<a:rPr[^>]*\/>)?<a:t>1<\/a:t><\/a:fld>/)
    expect(xml).toMatch(/<a:rPr[^>]*baseline="-25000"/)
    // The field comes back as a field.
    const reopened = new Y.Doc()
    await presentationCodec.importFile(reopened, await presentationCodec.exportFile(controller.doc, { name: 'deck.pptx', assets }), { name: 'deck.pptx', assets })
    expect(JSON.stringify(presentationCodec.toText(reopened))).toContain('1Big')
    reopened.destroy()
  })

  it('sends formatting to the speaker notes while they have focus', async () => {
    const { controller, slide, title } = await open()
    setShapeText(controller.doc, slide, title, plainToText('Title'), LOCAL_ORIGIN)
    controller.selectShapes([title])
    const host = document.createElement('div')
    document.body.append(host)
    const notes = new NotesEditor(host, controller)
    cleanup.push(() => notes.destroy())
    const view = host.querySelector<HTMLElement>('.pp-text-editor')!
    view.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(controller.notesFocused).toBe(true)
    const editor = (notes as unknown as { editor: InlineTextEditor }).editor
    editor.view.dispatch(editor.view.state.tr.insertText('Speaker words'))
    editor.select(1, 8)
    // Ctrl+B in the notes is no longer swallowed, and the toolbar's italic lands there too.
    view.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true }))
    controller.toggleMark('i')
    controller.setAlign('ctr')
    expect(controller.formatState()).toMatchObject({ bold: true, italic: true, notes: true, align: 'ctr', fontSize: 12 })
    const noteRuns = controller.slide(slide)!.notes!.text.content![0]!
    expect(noteRuns.content![0]).toMatchObject({ text: 'Speaker', marks: expect.arrayContaining([{ type: 'b', attrs: { value: true } }, { type: 'i', attrs: { value: true } }]) })
    expect(noteRuns.attrs?.pPr).toContain('algn="ctr"')
    expect(runs(controller, slide, title)[0]!.marks ?? []).toEqual([])
    // Selecting on the slide takes formatting back.
    controller.selectShapes([title])
    expect(controller.notesFocused).toBe(false)
    controller.toggleMark('b')
    expect(runs(controller, slide, title)[0]!.marks).toContainEqual({ type: 'b', attrs: { value: true } })
  })

  it('steps font sizes along the ladder and reads shortcuts by key and position', () => {
    expect([8, 11, 12, 44, 96, 100, 120].map((size) => steppedFontSize(size, 1))).toEqual([9, 12, 14, 48, 108, 108, 132])
    expect([8, 1, 10.5, 96, 108, 130].map((size) => steppedFontSize(size, -1))).toEqual([7, 1, 10, 88, 96, 120])
    const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)
    expect(textShortcut(key({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'align', value: 'ctr' })
    expect(textShortcut(key({ key: '>', code: 'Period', metaKey: true, shiftKey: true }))).toEqual({ kind: 'fontSize', delta: 1 })
    expect(textShortcut(key({ key: '&', code: 'Digit7', metaKey: true, shiftKey: true }))).toEqual({ kind: 'list', value: 'number' })
    // Ctrl+R and Ctrl+L stay the browser's.
    expect(textShortcut(key({ key: 'r', code: 'KeyR', ctrlKey: true }))).toBeUndefined()
    expect(textShortcut(key({ key: 'l', code: 'KeyL', ctrlKey: true }))).toBeUndefined()
    expect(requestShortcut(key({ key: 'h', code: 'KeyH', metaKey: true }))).toBeUndefined()
    expect(requestShortcut(key({ key: 'H', code: 'KeyH', metaKey: true, shiftKey: true }))).toBe('replace')
    expect(requestShortcut(key({ key: 'h', code: 'KeyH', ctrlKey: true }))).toBe('replace')
    expect(requestShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true }))).toBe('link')
    expect([normalizeLink('example.com/a?b'), normalizeLink(' ada@example.com '), normalizeLink('HTTP://x.org'), normalizeLink('file:///etc/passwd'), normalizeLink('not a url')]).toEqual(['https://example.com/a?b', 'mailto:ada@example.com', 'HTTP://x.org', undefined, undefined])
  })

  it('leaves Control keys in text to macOS, where only Cmd makes a shortcut', async () => {
    const { controller, slide, title } = await open()
    setShapeText(controller.doc, slide, title, plainToText('hello world'), LOCAL_ORIGIN)
    const editor = edit(controller, slide, title)
    editor.select(1, 6)
    const requests: string[] = []
    cleanup.push(controller.onRequest((request) => requests.push(request)))
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    cleanup.push(() => platform.mockRestore())
    const key = (init: KeyboardEventInit) => editorShortcut(controller, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    const align = controller.formatState().align
    expect(align).not.toBe('r')
    // Ctrl+H deletes back, Ctrl+K to the end of the line, Ctrl+F moves on, Ctrl+Shift+E selects to the end.
    expect([key({ key: 'h', code: 'KeyH', ctrlKey: true }), key({ key: 'k', code: 'KeyK', ctrlKey: true }), key({ key: 'f', code: 'KeyF', ctrlKey: true }), key({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true }), key({ key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true })]).toEqual([false, false, false, false, false])
    expect(requests).toEqual([])
    expect(controller.formatState().align).toBe(align)
    // The Cmd keys do what the shortcuts list says, and Ctrl+M still adds a slide.
    expect([key({ key: 'f', code: 'KeyF', metaKey: true }), key({ key: 'H', code: 'KeyH', metaKey: true, shiftKey: true }), key({ key: 'k', code: 'KeyK', metaKey: true }), key({ key: 'R', code: 'KeyR', metaKey: true, shiftKey: true })]).toEqual([true, true, true, true])
    expect(requests).toEqual(['find', 'replace', 'link'])
    expect(controller.formatState().align).toBe('r')
    const slides = controller.slideKeys().length
    expect(key({ key: 'm', code: 'KeyM', ctrlKey: true })).toBe(true)
    expect(controller.slideKeys().length).toBe(slides + 1)
    // Elsewhere Control is the shortcut key.
    platform.mockReturnValue('Win32')
    expect(key({ key: 'h', code: 'KeyH', ctrlKey: true })).toBe(true)
    expect(requests.at(-1)).toBe('replace')
  })

  it('takes tel: links, as the link dialog does', async () => {
    const { controller, assets, slide, title } = await open()
    setShapeText(controller.doc, slide, title, plainToText('Call us'), LOCAL_ORIGIN)
    expect(normalizeLink(' tel:+15551234567 ')).toBe('tel:+15551234567')
    expect(normalizeLink('tel:')).toBeUndefined()
    expect(normalizeLink('tel:+1 555')).toBeUndefined()
    const editor = edit(controller, slide, title)
    editor.select(1, 8)
    expect(controller.setLink('tel:+15551234567')).toBe(true)
    expect(controller.formatState().link).toBe('tel:+15551234567')
    const { xml, rels } = await exportedSlide(controller, assets)
    const id = /<a:hlinkClick[^>]*r:id="(rId\d+)"/.exec(xml)?.[1]
    expect(rels).toMatch(new RegExp(`Id="${id}"[^>]*Target="tel:\\+15551234567"[^>]*TargetMode="External"|Target="tel:\\+15551234567"[^>]*Id="${id}"`))
  })
})
