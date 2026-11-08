// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { blankPresentation, presentationCodec, presentationCommands } from '@pulpo/client-core/office/presentation'
import { NotesEditor, PresentationController } from '@pulpo/client-core/office/presentation/view'
import type { MenuEntry, MenuItemEntry } from '../chrome/menu'
import { firstMatchFrom } from './find'
import {
  alignSubmenu,
  arrangeMenuEntries,
  asUndoSteps,
  canvasContextEntries,
  editMenuEntries,
  formatMenuEntries,
  insertMenuEntries,
  moveSlides,
  sectionOf,
  shapeContextEntries,
  slideContextEntries,
  slideMenuEntries,
  slidePosition,
  tableEntries,
  type PresentationMenuHost,
} from './presentation-menus'

function memoryAssets(): LiveAssetStore {
  const store = new Map<string, Uint8Array>()
  return {
    async put(bytes, mimeType) {
      const hash = `asset-${store.size}`
      store.set(hash, bytes)
      return { hash, mimeType, sizeBytes: bytes.byteLength }
    },
    async get(hash) {
      return store.get(hash)!
    },
  }
}

// ProseMirror scrolls the selection into view; jsdom has no layout, so ranges measure as empty.
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect

const controllers: PresentationController[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy()
})

async function deck(slides = 1) {
  const doc = new Y.Doc()
  const assets = memoryAssets()
  await presentationCodec.importFile(doc, blankPresentation(), { name: 'deck.pptx', assets })
  const controller = new PresentationController({ doc, assets, readOnly: false, user: { name: 'Ada', color: '#2f6fed' } })
  controllers.push(controller)
  for (let index = 1; index < slides; index++) controller.addSlide()
  controller.goToSlide(controller.slideKeys()[0]!)
  return controller
}

function host(controller: PresentationController, overrides: Partial<PresentationMenuHost> = {}): PresentationMenuHost {
  return {
    controller,
    view: 'editor',
    openFind: vi.fn(),
    openLink: vi.fn(),
    openFormatPanel: vi.fn(),
    openBackground: vi.fn(),
    insertImage: vi.fn(),
    addSection: vi.fn(),
    renameSection: vi.fn(),
    alignTo: 'auto',
    setAlignTo: vi.fn(),
    ...overrides,
  }
}

/** A row by id, submenus included. */
function find(entries: readonly MenuEntry[], id: string): MenuEntry | undefined {
  for (const entry of entries) {
    if ('id' in entry && entry.id === id) return entry
    if (entry.type === 'submenu') {
      const found = find(entry.items, id)
      if (found) return found
    }
  }
  return undefined
}

function item(entries: readonly MenuEntry[], id: string): MenuItemEntry {
  const found = find(entries, id)
  if (found?.type !== 'item') throw new Error(`No item ${id}`)
  return found
}

function textBox(controller: PresentationController, text: string, x = 100_000): string {
  const slide = controller.state.slide!
  const [key] = presentationCommands.insertShapes(controller.doc, slide, [presentationCommands.textBox({ x, y: 100_000, cx: 2_000_000, cy: 500_000 }, `Text ${x}`, text)])
  return key!
}

describe('presentation menus', () => {
  it('Edit acts on the selected shapes, and on the slide when nothing is selected', async () => {
    const controller = await deck()
    const empty = editMenuEntries(host(controller))
    expect(item(empty, 'cut').disabled).toBe(true)
    expect(item(empty, 'copy').disabled).toBe(false)
    expect(item(empty, 'delete').disabled).toBe(true)
    const key = textBox(controller, 'Hello')
    const count = controller.slide(controller.state.slide!)!.shapes.length
    controller.selectShapes([key])
    const entries = editMenuEntries(host(controller))
    expect(item(entries, 'cut').disabled).toBe(false)
    expect(item(entries, 'delete').disabled).toBe(false)
    item(entries, 'duplicate').onSelect()
    expect(controller.slide(controller.state.slide!)!.shapes).toHaveLength(count + 1)
    item(editMenuEntries(host(controller)), 'select-all').onSelect()
    expect(controller.state.shapes).toHaveLength(count + 1)
    item(editMenuEntries(host(controller)), 'find').onSelect()
    item(editMenuEntries(host(controller)), 'replace').onSelect()
  })

  it('Edit ▸ Delete and Select all act on the speaker notes being typed in, not on the slide', async () => {
    const controller = await deck()
    const slide = controller.state.slide!
    const shapes = controller.slide(slide)!.shapes.map((shape) => shape.key)
    // The title stays selected while the notes take the keyboard, as in PowerPoint.
    controller.selectShapes([shapes[0]!])
    const element = document.createElement('div')
    document.body.append(element)
    const notes = new NotesEditor(element, controller)
    try {
      element.querySelector('.pp-text-editor')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      const editor = controller.notesEditor!
      expect(controller.notesFocused).toBe(true)
      editor.view.dispatch(editor.view.state.tr.insertText('hello world'))
      editor.select(1, 7)
      const entries = editMenuEntries(host(controller))
      expect(item(entries, 'cut').disabled).toBe(true)
      expect(item(entries, 'delete').disabled).toBe(false)
      item(entries, 'delete').onSelect()
      expect(controller.slide(slide)!.shapes.map((shape) => shape.key)).toEqual(shapes)
      expect(editor.view.state.doc.textContent).toBe('world')
      item(editMenuEntries(host(controller)), 'select-all').onSelect()
      expect(controller.notesFocused).toBe(true)
      expect(controller.state.shapes).toEqual([shapes[0]])
      const { from, to } = editor.view.state.selection
      expect(editor.view.state.doc.textBetween(from, to)).toBe('world')
    } finally {
      notes.destroy()
      element.remove()
    }
  })

  it('in the sorter, Edit acts on the selected slides', async () => {
    const controller = await deck(3)
    const entries = editMenuEntries(host(controller, { view: 'sorter' }))
    expect(item(entries, 'cut').disabled).toBe(false)
    item(entries, 'select-all').onSelect()
    expect(controller.state.slides).toEqual(controller.slideKeys())
    // Every slide selected: there would be none left.
    expect(item(editMenuEntries(host(controller, { view: 'sorter' })), 'delete').disabled).toBe(true)
  })

  it('makes each menu command an undo step of its own', async () => {
    const controller = await deck()
    const key = textBox(controller, 'Hello')
    const count = controller.slide(controller.state.slide!)!.shapes.length
    controller.selectShapes([key])
    // Two commands in quick succession: undo takes back only the second.
    item(asUndoSteps(controller, shapeContextEntries(host(controller), key)), 'duplicate').onSelect()
    const copy = controller.state.shapes[0]!
    item(asUndoSteps(controller, shapeContextEntries(host(controller), copy)), 'rotate-right').onSelect()
    expect(controller.shapeXfrm(controller.state.slide!, copy)!.rot).toBe(5_400_000)
    controller.undo()
    expect(controller.shapeXfrm(controller.state.slide!, copy)?.rot ?? 0).toBe(0)
    expect(controller.slide(controller.state.slide!)!.shapes).toHaveLength(count + 1)
  })

  it('moves slides to the beginning, up, down, and to the end, and knows when they cannot', async () => {
    const controller = await deck(4)
    const [a, b, c, d] = controller.slideKeys()
    controller.goToSlide(a!)
    expect(slidePosition(controller)).toMatchObject({ canMoveUp: false, canMoveDown: true })
    expect(find(slideMenuEntries(host(controller)), 'move-up')).toMatchObject({ disabled: true })
    moveSlides(controller, 'down')
    expect(controller.slideKeys()).toEqual([b, a, c, d])
    moveSlides(controller, 'end')
    expect(controller.slideKeys()).toEqual([b, c, d, a])
    expect(slidePosition(controller)).toMatchObject({ canMoveUp: true, canMoveDown: false })
    moveSlides(controller, 'up')
    expect(controller.slideKeys()).toEqual([b, c, a, d])
    moveSlides(controller, 'start')
    expect(controller.slideKeys()).toEqual([a, b, c, d])
    // Two slides selected together at the top cannot move up.
    controller.goToSlide(b!, 'range')
    expect(controller.state.slides).toEqual([a, b])
    expect(slidePosition(controller)).toMatchObject({ canMoveUp: false, canMoveDown: true })
  })

  it('table rows and columns act on the right-clicked cell; deleting needs a cell', async () => {
    const controller = await deck()
    const table = controller.insertTable(2, 2)!
    const model = () => controller.shape(controller.state.slide!, table)!.table!
    const whole = tableEntries(controller)
    expect(item(whole, 'insert-row-above').disabled).toBe(false)
    expect(item(whole, 'delete-row').disabled).toBe(true)
    const cell = { row: model().rows[1]!.key, column: model().columns[0]!.key }
    const entries = tableEntries(controller, cell)
    expect(item(entries, 'delete-row').disabled).toBe(false)
    item(entries, 'insert-row-above').onSelect()
    expect(model().rows).toHaveLength(3)
    expect(model().rows[2]!.key).toBe(cell.row)
    item(tableEntries(controller, cell), 'delete-column').onSelect()
    expect(model().columns).toHaveLength(1)
    // The shape menu of a table carries the table rows.
    expect(find(shapeContextEntries(host(controller), table, cell), 'insert-column-left')).toBeDefined()
    expect(find(shapeContextEntries(host(controller), table), 'edit-text')).toMatchObject({ disabled: true })
  })

  it('formats through the Format menu: highlight, text fitting, and clear formatting', async () => {
    const controller = await deck()
    const key = textBox(controller, 'Hello')
    controller.selectShapes([key])
    item(formatMenuEntries(host(controller)), 'highlight-FFFF00').onSelect()
    expect(controller.formatState().highlight).toContain('FFFF00')
    expect(item(formatMenuEntries(host(controller)), 'highlight-FFFF00').checked).toBe(true)
    item(formatMenuEntries(host(controller)), 'superscript').onSelect()
    expect(controller.formatState().baseline).toBe('sup')
    item(formatMenuEntries(host(controller)), 'autofit-shape').onSelect()
    expect(controller.formatState().textBox?.autofit).toBe('shape')
    item(formatMenuEntries(host(controller)), 'anchor-ctr').onSelect()
    expect(controller.formatState().textBox?.anchor).toBe('ctr')
    item(formatMenuEntries(host(controller)), 'clear-formatting').onSelect()
    expect(controller.formatState()).toMatchObject({ baseline: 'none' })
    expect(controller.formatState().highlight).toBeUndefined()
    // No text to format: the text submenus are off.
    controller.selectShapes([])
    expect(find(formatMenuEntries(host(controller)), 'text')).toMatchObject({ disabled: true })
  })

  it('aligns one shape to the slide, and several to each other unless asked to align to the slide', async () => {
    const controller = await deck()
    const first = textBox(controller, 'One', 300_000)
    const second = textBox(controller, 'Two', 900_000)
    controller.selectShapes([first])
    const single = alignSubmenu(host(controller))
    expect(item(single.type === 'submenu' ? single.items : [], 'align-to-slide')).toMatchObject({ checked: true, disabled: true })
    item(single.type === 'submenu' ? single.items : [], 'align-left').onSelect()
    expect(controller.shapeXfrm(controller.state.slide!, first)!.x).toBe(0)
    controller.selectShapes([first, second])
    const several = alignSubmenu(host(controller))
    item(several.type === 'submenu' ? several.items : [], 'align-right').onSelect()
    expect(controller.shapeXfrm(controller.state.slide!, first)!.x).toBe(controller.shapeXfrm(controller.state.slide!, second)!.x)
    // Center on page centers whatever is selected on the slide.
    controller.selectShapes([second])
    const width = controller.size().width * 9525
    item(arrangeMenuEntries(host(controller)), 'center-horizontal').onSelect()
    const xfrm = controller.shapeXfrm(controller.state.slide!, second)!
    expect(Math.abs(xfrm.x - (width - xfrm.cx) / 2)).toBeLessThan(2)
  })

  it('centers several shapes on the page as one, keeping their spacing (one undo step)', async () => {
    const controller = await deck()
    const left = textBox(controller, 'Left', 300_000)
    const right = textBox(controller, 'Right', 2_700_000)
    const slide = controller.state.slide!
    controller.selectShapes([left, right])
    const before = [controller.shapeXfrm(slide, left)!, controller.shapeXfrm(slide, right)!]
    item(asUndoSteps(controller, arrangeMenuEntries(host(controller))), 'center-horizontal').onSelect()
    const after = [controller.shapeXfrm(slide, left)!, controller.shapeXfrm(slide, right)!]
    // Moved together: the gap between them stays, and the pair's middle is the slide's.
    expect(after[1]!.x - after[0]!.x).toBe(before[1]!.x - before[0]!.x)
    const width = controller.size().width * 9525
    expect(Math.abs((after[0]!.x + after[1]!.x + after[1]!.cx) / 2 - width / 2)).toBeLessThanOrEqual(1)
    expect(after.map((xfrm) => xfrm.y)).toEqual(before.map((xfrm) => xfrm.y))
    item(arrangeMenuEntries(host(controller)), 'center-vertical').onSelect()
    const height = controller.size().height * 9525
    const moved = [controller.shapeXfrm(slide, left)!, controller.shapeXfrm(slide, right)!]
    expect(Math.abs(moved[0]!.y + moved[0]!.cy / 2 - height / 2)).toBeLessThanOrEqual(1)
    controller.undo()
    controller.undo()
    expect([controller.shapeXfrm(slide, left)!.x, controller.shapeXfrm(slide, right)!.x]).toEqual(before.map((xfrm) => xfrm.x))
  })

  it('offers no shapes, pictures, or tables to insert from the sorter, which shows no slide', async () => {
    const controller = await deck()
    const sorter = insertMenuEntries(host(controller, { view: 'sorter' }))
    for (const id of ['text-box', 'image', 'insert-shape', 'insert-line', 'insert-table']) expect(find(sorter, id), id).toMatchObject({ disabled: true })
    expect(find(sorter, 'new-slide')).toMatchObject({ disabled: false })
    const editor = insertMenuEntries(host(controller))
    for (const id of ['text-box', 'image', 'insert-shape', 'insert-line', 'insert-table']) expect(find(editor, id), id).toMatchObject({ disabled: false })
  })

  it('cuts slides only while at least one stays behind', async () => {
    const controller = await deck(2)
    expect(item(editMenuEntries(host(controller, { view: 'sorter' })), 'cut').disabled).toBe(false)
    controller.selectAllSlides()
    expect(item(editMenuEntries(host(controller, { view: 'sorter' })), 'cut').disabled).toBe(true)
    expect(item(slideContextEntries(host(controller), controller.state.slide!), 'cut').disabled).toBe(true)
    // Copying every slide is fine.
    expect(item(editMenuEntries(host(controller, { view: 'sorter' })), 'copy').disabled).toBe(false)
  })

  it('offers slide commands on the slide and its thumbnails, sections included', async () => {
    const controller = await deck(3)
    const [a, b] = controller.slideKeys()
    const section = controller.addSection('Intro', a)!
    controller.addSection('Body', b)
    expect(sectionOf(controller, a!)?.key).toBe(section)
    expect(sectionOf(controller, controller.slideKeys()[2]!)?.name).toBe('Body')
    controller.goToSlide(a!)
    const menuHost = host(controller)
    const thumbnail = slideContextEntries(menuHost, a!)
    item(thumbnail, 'rename-section').onSelect()
    expect(menuHost.renameSection).toHaveBeenCalledWith(section)
    item(thumbnail, 'add-section').onSelect()
    expect(menuHost.addSection).toHaveBeenCalledWith(a)
    item(thumbnail, 'hide-slide').onSelect()
    expect(controller.slide(a!)!.hidden).toBe(true)
    expect(item(slideContextEntries(menuHost, a!), 'hide-slide').checked).toBe(true)
    item(canvasContextEntries(menuHost), 'change-background').onSelect()
    expect(menuHost.openBackground).toHaveBeenCalled()
    item(canvasContextEntries(menuHost), 'new-slide').onSelect()
    expect(controller.slideKeys()).toHaveLength(4)
  })

  it('inserts fields and symbols only while text is being typed', async () => {
    const controller = await deck()
    const entries = insertMenuEntries(host(controller))
    expect(find(entries, 'slide-number')).toMatchObject({ disabled: true })
    expect(find(entries, 'special-characters')).toMatchObject({ disabled: true })
    expect(find(entries, 'link')).toMatchObject({ disabled: true })
    const key = textBox(controller, 'Hello')
    controller.selectShapes([key])
    expect(find(insertMenuEntries(host(controller)), 'link')).toMatchObject({ disabled: false })
  })

  it('disables every edit for viewers', async () => {
    const controller = await deck(2)
    const key = textBox(controller, 'Hello')
    controller.selectShapes([key])
    controller.setReadOnly(true)
    const shape = shapeContextEntries(host(controller), key)
    for (const id of ['cut', 'paste', 'duplicate', 'delete', 'edit-text', 'link', 'format-options']) expect(find(shape, id), id).toMatchObject({ disabled: true })
    expect(find(shape, 'copy')).toMatchObject({ disabled: false })
    for (const id of ['new-slide', 'delete-slide', 'hide-slide', 'layout']) expect(find(slideContextEntries(host(controller), controller.state.slide!), id), id).toMatchObject({ disabled: true })
  })
})

describe('find', () => {
  it('starts at the first match on the current slide or after it', () => {
    const match = (slide: string) => ({ slide, paragraph: 0, from: 0, to: 1, text: 'a' })
    const matches = [match('s1'), match('s3'), match('s3')]
    expect(firstMatchFrom(matches, ['s1', 's2', 's3'], 's2')).toBe(1)
    expect(firstMatchFrom(matches, ['s1', 's2', 's3'], 's1')).toBe(0)
    expect(firstMatchFrom(matches, ['s1', 's2', 's3', 's4'], 's4')).toBe(0)
    expect(firstMatchFrom([], ['s1'], 's1')).toBe(0)
  })
})
