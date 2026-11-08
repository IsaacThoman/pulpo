import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { blankPresentation } from './blank.js'
import { presentationCodec } from './codec.js'
import { addSlide, cellFragment, groupShapes, insertShapes, setNotesText, setShapeText, slideKeys, tableShape, textBox } from './commands.js'
import { findMatches, replaceAll, replaceMatch } from './find.js'
import { DeckResources } from './render/deck.js'
import { normalizeText, plainToText, textToPlain, type TextJSON } from './text.js'
import { memoryAssets } from './testing/assets.js'
import { readSnapshot } from './ydoc.js'
import { PresentationController } from './view/controller.js'

const ORIGIN = { local: true }

async function deck() {
  const assets = memoryAssets()
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, blankPresentation(), { name: 'deck.pptx', assets })
  const snapshot = readSnapshot(doc)
  const resources = new DeckResources(snapshot.parts, snapshot.mainPart)
  const layout = resources.master(resources.masterPaths()[0]!)!.layouts.find((path) => resources.layout(path)?.name === 'Blank')!
  const [first] = slideKeys(doc)
  const second = addSlide(doc, resources, layout, 1, ORIGIN)
  const [title] = readSnapshot(doc).slides[0]!.shapes
  setShapeText(doc, first!, title!.key, bold('Alpha ', 'beta', ' gamma'), ORIGIN)
  const box = { x: 0, y: 0, cx: 1_000_000, cy: 400_000 }
  const [one, two] = insertShapes(doc, second, [textBox(box, 'One', 'beta one'), textBox(box, 'Two', 'Beta two')], ORIGIN)
  const group = groupShapes(doc, second, [one!, two!], new Map([[one!, box], [two!, box]]), 'Group', ORIGIN)!
  const table = tableShape(2, 2, { x: 0, y: 1_000_000, cx: 2_000_000, cy: 800_000 }, 'Table')
  table.table!.rows[1]!.cells[table.table!.columns[1]!.key]!.text = plainToText('a beta cell')
  insertShapes(doc, second, [table], ORIGIN)
  setNotesText(doc, second, plainToText('alphabeta\nbeta notes'), ORIGIN)
  return { doc, assets, first: first!, second, title: title!.key, one: one!, two: two!, group, table: table.key }
}

function bold(before: string, text: string, after: string): TextJSON {
  return normalizeText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: before }, { type: 'text', text, marks: [{ type: 'b', attrs: { value: true } }] }, { type: 'text', text: after }] }] })
}

describe('find and replace', () => {
  it('finds in deck order: shapes, group members, table cells, then notes', async () => {
    const { doc, first, second, title, one, two, group, table } = await deck()
    const matches = findMatches(doc, 'beta')
    expect(matches.map((match) => [match.slide, match.shape ?? 'notes', match.root ?? '', match.row ? 'cell' : '', match.paragraph, match.from, match.text])).toEqual([
      [first, title, title, '', 0, 6, 'beta'],
      [second, one, group, '', 0, 0, 'beta'],
      [second, two, group, '', 0, 0, 'Beta'],
      [second, table, table, 'cell', 0, 2, 'beta'],
      [second, 'notes', '', '', 0, 5, 'beta'],
      [second, 'notes', '', '', 1, 0, 'beta'],
    ])
    expect(findMatches(doc, 'beta', { matchCase: true }).map((match) => match.text)).not.toContain('Beta')
    // Whole words: "alphabeta" holds "beta" and "bet" only inside a word.
    expect(findMatches(doc, 'bet', { wholeWord: true })).toEqual([])
    expect(findMatches(doc, 'beta', { wholeWord: true }).length).toBe(5)
    expect(findMatches(doc, '')).toEqual([])
    expect(findMatches(doc, 'a.b')).toEqual([])
  })

  it('replaces a match keeping its formatting, and refuses a match that changed since', async () => {
    const { doc, assets } = await deck()
    const [match] = findMatches(doc, 'beta')
    expect(replaceMatch(doc, match!, 'delta', ORIGIN)).toBe(true)
    const runs = readSnapshot(doc).slides[0]!.shapes[0]!.text!.content![0]!.content!
    expect(runs).toEqual([{ type: 'text', text: 'Alpha ' }, { type: 'text', text: 'delta', marks: [{ type: 'b', attrs: { value: true } }] }, { type: 'text', text: ' gamma' }])
    // The match is gone, so replacing it again does nothing.
    expect(replaceMatch(doc, match!, 'epsilon', ORIGIN)).toBe(false)
    expect(textToPlain(readSnapshot(doc).slides[0]!.shapes[0]!.text!)).toBe('Alpha delta gamma')
    const reopened = new Y.Doc()
    await presentationCodec.importFile(reopened, await presentationCodec.exportFile(doc, { name: 'deck.pptx', assets }), { name: 'deck.pptx', assets })
    expect(presentationCodec.toText(reopened)).toContain('Alpha delta gamma')
    reopened.destroy()
  })

  it('replaces everything as one undo step, merging with typing elsewhere in the same text', async () => {
    const { doc, assets, second, table } = await deck()
    const controller = new PresentationController({ doc, assets, readOnly: false, user: { name: 'A', color: '#123456' } })
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    expect(controller.replaceAll('beta', 'zeta')).toBe(6)
    // Meanwhile someone types in a cell of the table and in the notes paragraph with a match.
    const row = readSnapshot(other).slides[1]!.shapes.find((shape) => shape.key === table)!.table!.rows[1]!
    const column = readSnapshot(other).slides[1]!.shapes.find((shape) => shape.key === table)!.table!.columns[1]!
    const cell = ((cellFragment(other, second, table, row.key, column.key)!.get(0) as Y.XmlElement).get(0) as Y.XmlText)
    other.transact(() => cell.insert(0, 'X '), ORIGIN)
    const notes = (((readNotes(other, second).get(1) as Y.XmlElement).get(0)) as Y.XmlText)
    other.transact(() => notes.insert(notes.length, '!'), ORIGIN)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)))
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other)))
    expect(presentationCodec.toText(doc)).toBe(presentationCodec.toText(other))
    const text = presentationCodec.toText(doc)
    expect(text).toContain('X a zeta cell')
    expect(text).toContain('zeta notes!')
    expect(text).not.toMatch(/beta/i)
    controller.undo()
    expect(findMatches(doc, 'beta').length).toBe(6)
    expect(presentationCodec.toText(doc)).toContain('X a beta cell')
    controller.destroy()
    other.destroy()
  })

  it('reveals matches through the controller and keeps replace out of read-only views', async () => {
    const { doc, assets, second, group, table } = await deck()
    const controller = new PresentationController({ doc, assets, readOnly: false, user: { name: 'A', color: '#123456' } })
    const matches = controller.find('beta')
    controller.revealMatch(matches[1]!)
    // A group member selects its group.
    expect(controller.state).toMatchObject({ slide: second, shapes: [group] })
    expect(controller.state.editing).toBeUndefined()
    controller.revealMatch(matches[3]!)
    expect(controller.state.editing).toMatchObject({ slide: second, shape: table })
    expect(controller.takeReveal(controller.state.editing!)).toEqual({ paragraph: 0, from: 2, to: 6, focus: false })
    expect(controller.takeReveal(controller.state.editing!)).toBeUndefined()
    controller.revealMatch(matches[4]!, { focus: true })
    expect(controller.state.editing).toBeUndefined()
    expect(controller.takeReveal({ notes: true, slide: second })).toEqual({ paragraph: 0, from: 5, to: 9, focus: true })
    controller.setReadOnly(true)
    expect(controller.replaceAll('beta', 'x')).toBe(0)
    expect(controller.replaceMatch(matches[0]!, 'x')).toBe(false)
    expect(controller.find('beta').length).toBe(6)
    controller.destroy()
  })
})

function readNotes(doc: Y.Doc, slide: string): Y.XmlFragment {
  return ((doc.getMap('presentation').get('slides') as Y.Map<Y.Map<unknown>>).get(slide)!.get('notes') as Y.Map<unknown>).get('text') as Y.XmlFragment
}
