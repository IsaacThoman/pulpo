// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from '../blank.js'
import { presentationCodec } from '../codec.js'
import { setShapeText } from '../commands.js'
import { plainToText, textToPlain } from '../text.js'
import { memoryAssets } from '../testing/assets.js'
import { SlideCanvas, type SlideCanvasOptions } from './canvas.js'
import { LOCAL_ORIGIN, PresentationController } from './controller.js'
import { NotesEditor } from './notes.js'
import { SlideList } from './thumbnails.js'

// ProseMirror scrolls the selection into view; jsdom has no layout, so ranges measure as empty.
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const step of cleanup.splice(0).reverse()) step()
  document.body.replaceChildren()
})

async function mount(options: SlideCanvasOptions = {}) {
  const assets = memoryAssets()
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, blankPresentation(), { name: 'deck.pptx', assets })
  const controller = new PresentationController({ doc, assets, readOnly: false, user: { name: 'Editor', color: '#123456' } })
  const host = document.createElement('div')
  document.body.append(host)
  const canvas = new SlideCanvas(host, controller, options)
  cleanup.push(() => { canvas.destroy(); controller.destroy(); doc.destroy() })
  await Promise.resolve()
  return { controller, canvas, host }
}

const key = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('slide canvas events', () => {
  it('passes the shape and table cell under a right click, and leaves text being edited to the browser', async () => {
    const onContextMenu = vi.fn()
    const { controller, host } = await mount({ onContextMenu })
    const table = controller.insertTable(2, 2)!
    controller.selectShapes([])
    await Promise.resolve()
    const cell = host.querySelector(`.pp-slide > [data-key="${table}"] td[data-row="1"][data-col="0"]`)!
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    cell.dispatchEvent(menu)
    const model = controller.shape(controller.state.slide!, table)!.table!
    expect(menu.defaultPrevented).toBe(true)
    expect(onContextMenu).toHaveBeenLastCalledWith(menu, table, { row: model.rows[1]!.key, column: model.columns[0]!.key })
    expect(controller.state.shapes).toEqual([table])
    // Empty slide area: no shape.
    host.querySelector('.pp-canvas-viewport')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(onContextMenu.mock.lastCall?.[1]).toBeUndefined()
    // Inside the inline editor the native menu (spelling suggestions) stays.
    const title = controller.slide(controller.state.slide!)!.shapes[0]!.key
    controller.setState({ shapes: [title], editing: { slide: controller.state.slide!, shape: title } })
    await Promise.resolve()
    await Promise.resolve()
    const text = host.querySelector('.pp-text-editor')!
    const native = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    text.dispatchEvent(native)
    expect(native.defaultPrevented).toBe(false)
    expect(onContextMenu).toHaveBeenCalledTimes(2)
  })

  it('formats selected shapes with shortcuts, takes Ctrl+M and Cmd+D, and leaves browser keys alone', async () => {
    const onZoomChange = vi.fn()
    const { controller, canvas } = await mount({ onZoomChange })
    const slide = controller.state.slide!
    const title = controller.slide(slide)!.shapes[0]!.key
    setShapeText(controller.doc, slide, title, plainToText('Title'), LOCAL_ORIGIN)
    controller.selectShapes([title])
    expect(key(canvas.element, { key: 'b', code: 'KeyB', metaKey: true }).defaultPrevented).toBe(true)
    expect(controller.formatState().bold).toBe(true)
    key(canvas.element, { key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true })
    expect(controller.formatState().align).toBe('r')
    // Ctrl+R (reload) and Cmd+F (find, no host listening) stay the browser's.
    expect(key(canvas.element, { key: 'r', code: 'KeyR', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(key(canvas.element, { key: 'f', code: 'KeyF', metaKey: true }).defaultPrevented).toBe(false)
    const requests: string[] = []
    controller.onRequest((request) => requests.push(request))
    expect(key(canvas.element, { key: 'f', code: 'KeyF', metaKey: true }).defaultPrevented).toBe(true)
    expect(requests).toEqual(['find'])
    key(canvas.element, { key: 'Escape', code: 'Escape' })
    key(canvas.element, { key: 'm', code: 'KeyM', ctrlKey: true })
    expect(controller.slideKeys().length).toBe(2)
    // Cmd+M is the system's (minimize).
    expect(key(canvas.element, { key: 'm', code: 'KeyM', metaKey: true }).defaultPrevented).toBe(false)
    key(canvas.element, { key: 'd', code: 'KeyD', metaKey: true })
    expect(controller.slideKeys().length).toBe(3)
    key(canvas.element, { key: 'Home', code: 'Home' })
    expect(controller.state.slide).toBe(controller.slideKeys()[0])
    key(canvas.element, { key: 'PageDown', code: 'PageDown' })
    expect(controller.state.slide).toBe(controller.slideKeys()[1])
    // Zoom reports every change, and fit is a mode that can come back.
    onZoomChange.mockClear()
    canvas.setZoom(1.5)
    expect(onZoomChange).toHaveBeenLastCalledWith(1.5, false)
    canvas.zoomIn()
    expect(canvas.getZoom()).toBe(1.75)
    key(canvas.element, { key: '–', code: 'Minus', metaKey: true, altKey: true })
    expect(canvas.getZoom()).toBe(1.5)
    canvas.setZoom('fit')
    expect(canvas.isFit()).toBe(true)
    expect(onZoomChange.mock.lastCall?.[1]).toBe(true)
  })

  it('keeps keys in text find opened without focus, and gives it focus back', async () => {
    const { controller, canvas, host } = await mount()
    const slide = controller.state.slide!
    const title = controller.slide(slide)!.shapes[0]!.key
    setShapeText(controller.doc, slide, title, plainToText('Find this word'), LOCAL_ORIGIN)
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    const [match] = controller.find('word')
    controller.revealMatch(match!)
    await Promise.resolve()
    await Promise.resolve()
    const text = host.querySelector<HTMLElement>('.pp-text-editor')!
    expect(document.activeElement).toBe(field)
    // Focus reaches the slide itself (Tab, or a host focusing the element): typing must not
    // replace the shape's whole text, and Delete must not remove the shape.
    canvas.element.focus()
    for (const init of [{ key: 'x', code: 'KeyX' }, { key: 'Delete', code: 'Delete' }, { key: 'ArrowLeft', code: 'ArrowLeft' }]) {
      expect(key(canvas.element, init).defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(text)
      canvas.element.focus()
    }
    await Promise.resolve()
    expect(textToPlain(controller.shape(slide, title)!.text!)).toBe('Find this word')
    expect(controller.state.editing).toMatchObject({ shape: title })
    // The host's canvas.focus() (closing its find bar) returns to the text, the match still selected.
    field.focus()
    canvas.focus()
    expect(document.activeElement).toBe(text)
    const selection = controller.activeEditor!.view.state.selection
    expect(controller.activeEditor!.view.state.doc.textBetween(selection.from, selection.to)).toBe('word')
  })

  it('takes text formatting back from the speaker notes when the slide gets focus', async () => {
    const { controller, canvas } = await mount()
    const slide = controller.state.slide!
    const title = controller.slide(slide)!.shapes[0]!.key
    setShapeText(controller.doc, slide, title, plainToText('Title'), LOCAL_ORIGIN)
    controller.selectShapes([title])
    const notesHost = document.createElement('div')
    document.body.append(notesHost)
    const notes = new NotesEditor(notesHost, controller)
    cleanup.push(() => notes.destroy())
    notesHost.querySelector<HTMLElement>('.pp-text-editor')!.focus()
    expect(controller.notesFocused).toBe(true)
    // Focus moves to the slide without a click (Tab, or a host focusing it): Cmd+B bolds the selected shape.
    canvas.element.focus()
    expect(controller.notesFocused).toBe(false)
    key(canvas.element, { key: 'b', code: 'KeyB', metaKey: true })
    expect(controller.formatState()).toMatchObject({ bold: true, notes: false })
    expect(controller.shape(slide, title)!.text!.content![0]!.content![0]!.marks).toContainEqual({ type: 'b', attrs: { value: true } })
  })

  it('selects every slide with Cmd+A in the strip and starts a slide with Ctrl+M there', async () => {
    const { controller, host } = await mount()
    const strip = new SlideList(host, controller, { layout: 'strip' })
    cleanup.push(() => strip.destroy())
    controller.addSlide()
    key(strip.element, { key: 'm', code: 'KeyM', ctrlKey: true })
    expect(controller.slideKeys().length).toBe(3)
    key(strip.element, { key: 'a', code: 'KeyA', metaKey: true })
    expect(controller.state.slides).toEqual(controller.slideKeys())
    key(strip.element, { key: 'Home', code: 'Home' })
    expect(controller.state.slides).toEqual([controller.slideKeys()[0]])
  })

  it('dims a thumbnail as soon as its slide is hidden, and undims it when shown', async () => {
    const { controller, host } = await mount()
    const strip = new SlideList(host, controller, { layout: 'strip' })
    cleanup.push(() => strip.destroy())
    const second = controller.addSlide()!
    await Promise.resolve()
    const thumb = () => strip.element.querySelector<HTMLElement>(`.pp-thumb[data-slide="${second}"]`)!
    expect(thumb().classList.contains('pp-thumb-hidden')).toBe(false)
    // Hiding changes only the slide (no selection change): the strip still shows it at once.
    controller.setSlidesHidden(true, [second])
    await Promise.resolve()
    expect(thumb().classList.contains('pp-thumb-hidden')).toBe(true)
    controller.setSlidesHidden(false, [second])
    await Promise.resolve()
    expect(thumb().classList.contains('pp-thumb-hidden')).toBe(false)
  })
})
