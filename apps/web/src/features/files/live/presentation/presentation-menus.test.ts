// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { blankPresentation, presentationCodec, presentationCommands } from '@pulpo/client-core/office/presentation'
import { PresentationController } from '@pulpo/client-core/office/presentation/view'
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
