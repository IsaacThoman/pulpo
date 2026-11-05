import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { joinBackward, joinForward } from '@tiptap/pm/commands'
import { history, undo } from '@tiptap/pm/history'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it, vi } from 'vitest'
import { addRowAfter, addRowBefore, deleteRow, TableMap } from '@tiptap/pm/tables'
import * as Y from 'yjs'
import { docxCodec } from './codec.js'
import { diffDocxModels, diffWords } from './diff.js'
import { packJml, type JmlElement } from './jsonml.js'
import { MemoryAssetStore } from './memory-assets.js'
import { BODY_FRAGMENT, readDocxModel, writeFragment, type DocxModel } from './model.js'
import { ListCounter, Numbering, formatNumber } from './numbering.js'
import { docxSchema, inlineMarks } from './schema.js'
import { StyleSheet, cellConditions, mergeElement, tableLook } from './styles.js'
import { clearFormatting, effectiveRunProperties, freshId, findMatches, insertTable, insertPageBreak, insertParagraphBreak, insertSectionBreak, listDefinition, replaceMatches, setAlignment, setFontSize, toggleList, toggleRunProperty, wordCount } from './view/commands.js'
import { DocxViewContext } from './view/context.js'
import { pasteSelection, sectionEndsPlugin } from './view/sections.js'
import { listRevisions, resolveRevisions, trackTransaction } from './view/track-changes.js'

const schema = docxSchema()
const style = (id: string, type: string, body: JmlElement[] = [], attrs: Record<string, string> = {}): [string, string] => [`style:${id}`, packJml(['w:style', { 'w:type': type, 'w:styleId': id, ...attrs }, ['w:name', { 'w:val': id }], ...body])]

describe('numbering', () => {
  it('shows huge counters as digits instead of repeating letters or symbols millions of times', () => {
    expect(formatNumber(28, 'lowerLetter')).toBe('bb')
    expect(formatNumber(1_000_000_000, 'lowerLetter')).toBe('1000000000')
    expect(formatNumber(5, 'chicago')).toBe('**')
    expect(formatNumber(1_000_000_000, 'chicago')).toBe('1000000000')
  })

  it('formats counters the way Word does', () => {
    expect(formatNumber(4, 'upperRoman')).toBe('IV')
    expect(formatNumber(1994, 'lowerRoman')).toBe('mcmxciv')
    expect(formatNumber(27, 'lowerLetter')).toBe('aa')
    expect(formatNumber(53, 'upperLetter')).toBe('AAA')
    expect(formatNumber(3, 'ordinal')).toBe('3rd')
    expect(formatNumber(12, 'ordinal')).toBe('12th')
    expect(formatNumber(21, 'cardinalText')).toBe('Twenty-one')
    expect(formatNumber(2, 'ordinalText')).toBe('Second')
    expect(formatNumber(5, 'decimalZero')).toBe('05')
    expect(formatNumber(3, 'chicago')).toBe('‡')
    expect(formatNumber(2, 'decimalEnclosedCircle')).toBe('②')
  })

  it('counts multi-level lists, restarts deeper levels, and honors overrides and shared definitions', () => {
    const entries: [string, string][] = [
      ['abstract:1', packJml(listDefinition('multilevel', '1'))],
      ['num:1', packJml(['w:num', { 'w:numId': '1' }, ['w:abstractNumId', { 'w:val': '1' }]])],
      ['num:2', packJml(['w:num', { 'w:numId': '2' }, ['w:abstractNumId', { 'w:val': '1' }], ['w:lvlOverride', { 'w:ilvl': '0' }, ['w:startOverride', { 'w:val': '7' }]]])],
      ['abstract:3', packJml(listDefinition('decimal', '3'))],
      ['num:3', packJml(['w:num', { 'w:numId': '3' }, ['w:abstractNumId', { 'w:val': '3' }]])],
      ['abstract:4', packJml(listDefinition('bullet', '4'))],
      ['num:4', packJml(['w:num', { 'w:numId': '4' }, ['w:abstractNumId', { 'w:val': '4' }]])],
    ]
    const counter = new ListCounter(new Numbering(entries))
    const labels = [[1, 0], [1, 1], [1, 1], [1, 2], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [3, 2], [3, 0], [4, 0], [4, 1]].map(([num, level]) => counter.next(String(num), level!)!.text)
    expect(labels).toEqual(['1.', '1.1.', '1.2.', '1.2.1.', '2.', '2.1.', '7.', '1.', 'a.', 'i.', '2.', '•', 'o'])
  })
})

describe('styles', () => {
  it('resolves basedOn chains and merges attributes like Word', () => {
    const sheet = new StyleSheet([
      ['docDefaults', packJml(['w:docDefaults', {}, ['w:rPrDefault', {}, ['w:rPr', {}, ['w:sz', { 'w:val': '22' }]]]])],
      style('Base', 'paragraph', [['w:pPr', {}, ['w:spacing', { 'w:after': '200' }], ['w:ind', { 'w:left': '720', 'w:hanging': '360' }]], ['w:rPr', {}, ['w:b', {}]]]),
      style('Derived', 'paragraph', [['w:basedOn', { 'w:val': 'Base' }], ['w:pPr', {}, ['w:spacing', { 'w:before': '100' }], ['w:ind', { 'w:firstLine': '200' }], ['w:outlineLvl', { 'w:val': '1' }]], ['w:rPr', {}, ['w:b', { 'w:val': '0' }]]]),
      style('Loop', 'paragraph', [['w:basedOn', { 'w:val': 'Loop' }]]),
      style('Normal', 'paragraph', [], { 'w:default': '1' }),
    ])
    const resolved = sheet.resolve('Derived')
    expect(resolved.pPr.get('w:spacing')![1]).toEqual({ 'w:after': '200', 'w:before': '100' })
    expect(resolved.pPr.get('w:ind')![1]).toEqual({ 'w:left': '720', 'w:firstLine': '200' })
    expect(resolved.rPr.get('w:b')![1]).toEqual({ 'w:val': '0' })
    expect(sheet.outlineLevel('Derived')).toBe(1)
    expect(sheet.chain('Loop')).toHaveLength(1)
    expect(sheet.paragraphStyle('Missing')?.id).toBe('Normal')
    expect(mergeElement(['w:tabs', {}, ['w:tab', { 'w:pos': '100', 'w:val': 'left' }]], ['w:tabs', {}, ['w:tab', { 'w:pos': '100', 'w:val': 'clear' }], ['w:tab', { 'w:pos': '50', 'w:val': 'right' }]])).toEqual(['w:tabs', {}, ['w:tab', { 'w:pos': '50', 'w:val': 'right' }]])
  })

  it('picks table style conditions by cell position', () => {
    const look = tableLook(['w:tblLook', { 'w:val': '04A0' }])
    expect(look).toMatchObject({ firstRow: true, firstColumn: true, lastRow: false, noVBand: true })
    expect(cellConditions(look, { row: 0, rows: 4, col: 0, cols: 3, headerRows: 1 })).toEqual(['wholeTable', 'firstCol', 'firstRow', 'nwCell'])
    expect(cellConditions(look, { row: 1, rows: 4, col: 1, cols: 3, headerRows: 1 })).toEqual(['wholeTable', 'band1Horz'])
    expect(cellConditions(look, { row: 2, rows: 4, col: 2, cols: 3, headerRows: 1 })).toEqual(['wholeTable', 'band2Horz'])
  })
})

const run = (text: string, ...marks: string[]) => schema.text(text, marks.map((name) => schema.mark(name, { v: packJml([`w:${name}`, {}]) })))
const p = (...content: ProseMirrorNode[]) => schema.node('paragraph', null, content)

async function documentWith(...paragraphs: ProseMirrorNode[]): Promise<{ doc: Y.Doc; model: DocxModel }> {
  const doc = new Y.Doc()
  await docxCodec.createEmpty(doc, { name: 'a.docx', assets: new MemoryAssetStore() })
  doc.transact(() => writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), schema.node('doc', null, paragraphs)))
  return { doc, model: readDocxModel(doc) }
}

describe('diff', () => {
  it('diffs words', () => {
    expect(diffWords('The quick brown fox', 'The slow brown fox jumps')).toEqual([
      { op: 'equal', text: 'The ' },
      { op: 'delete', text: 'quick' },
      { op: 'insert', text: 'slow' },
      { op: 'equal', text: ' brown fox' },
      { op: 'insert', text: ' jumps' },
    ])
  })

  it.each([false, true])('reports replacement picture bytes with unchanged drawing XML (in table: %s)', async (inTable) => {
    const picture = (src: string) => schema.node('drawing', { src, v: packJml(['w:drawing', {}]) })
    const block = (src: string) => inTable ? schema.node('table', null, [schema.node('tableRow', null, [schema.node('tableCell', null, [p(picture(src))])])]) : p(picture(src))
    const before = (await documentWith(block('original-hash'))).model
    const after = { ...before, body: schema.node('doc', null, [block('replacement-hash')]) }
    const diff = diffDocxModels(before, after)
    expect(diff.identical).toBe(false)
    expect(diff.stats.changedBlocks).toBe(1)
    expect(diff.blocks[0]).toMatchObject({ kind: 'modify', formats: [{ property: 'picture', text: '[Image]' }] })
  })

  it.each([
    ['7', 'decimal', ['7.', '8.']],
    ['1', 'upperRoman', ['I.', 'II.']],
  ])('reports resolved list labels when only the definition changes (%s, %s)', async (start, format, labels) => {
    const numPr = packJml(['w:numPr', {}, ['w:numId', { 'w:val': '1' }]])
    const before = (await documentWith(...['First', 'Second'].map((text) => schema.node('paragraph', { numPr }, schema.text(text))))).model
    const definition = (start: string, format: string) => packJml(['w:abstractNum', { 'w:abstractNumId': '1' },
      ['w:lvl', { 'w:ilvl': '0' }, ['w:start', { 'w:val': start }], ['w:numFmt', { 'w:val': format }], ['w:lvlText', { 'w:val': '%1.' }]]])
    before.maps.numbering.set('num:1', packJml(['w:num', { 'w:numId': '1' }, ['w:abstractNumId', { 'w:val': '1' }]]))
    before.maps.numbering.set('abstract:1', definition('1', 'decimal'))
    const after = { ...before, maps: { ...before.maps, numbering: new Map(before.maps.numbering).set('abstract:1', definition(start, format)) } }
    const diff = diffDocxModels(before, after)
    expect(diff.identical).toBe(false)
    expect(diff.stats).toMatchObject({ changedBlocks: 2, formatChanges: 3, insertedWords: 0, deletedWords: 0 })
    diff.blocks.forEach((block, index) => {
      expect(block).toMatchObject({ kind: 'modify', before: { label: `${index + 1}.` }, after: { label: labels[index] },
        formats: [{ property: 'numPr', text: '', before: `${index + 1}.`, after: labels[index] }] })
    })
  })

  it('includes table list labels and advances their counters before later body paragraphs', async () => {
    const numPr = packJml(['w:numPr', {}, ['w:numId', { 'w:val': '1' }]])
    const item = (text: string) => schema.node('paragraph', { numPr }, schema.text(text))
    const before = (await documentWith(schema.node('table', null, [schema.node('tableRow', null, [schema.node('tableCell', null, [item('Cell')])])]), item('Body'))).model
    before.maps.numbering.set('num:1', packJml(['w:num', { 'w:numId': '1' }, ['w:abstractNumId', { 'w:val': '1' }]]))
    before.maps.numbering.set('abstract:1', packJml(listDefinition('decimal', '1')))
    const after = { ...before, maps: { ...before.maps, numbering: new Map(before.maps.numbering).set('num:1',
      packJml(['w:num', { 'w:numId': '1' }, ['w:abstractNumId', { 'w:val': '1' }], ['w:lvlOverride', { 'w:ilvl': '0' }, ['w:startOverride', { 'w:val': '7' }]]])) } }
    const diff = diffDocxModels(before, after)
    expect(diff.blocks[0]).toMatchObject({ kind: 'modify', before: { text: '1. Cell' }, after: { text: '7. Cell' },
      segments: [{ op: 'delete', text: '1' }, { op: 'insert', text: '7' }, { op: 'equal', text: '. Cell' }] })
    expect(diff.blocks[1]).toMatchObject({ kind: 'modify', before: { label: '2.' }, after: { label: '8.' } })
  })

  it.each(['header', 'footer', 'footnote', 'endnote'])('reviews numbering-only changes in a %s', async (kind) => {
    const before = (await documentWith(p(run('Body')))).model
    const id = `${kind}:1`
    before.stories.set(id, { meta: { kind: kind as 'header' | 'footer' | 'footnote' | 'endnote' },
      doc: schema.node('doc', null, [schema.node('paragraph', { numPr: packJml(['w:numPr', {}, ['w:numId', { 'w:val': '1' }]]) }, schema.text('Story'))]) })
    before.maps.numbering.set('num:1', packJml(['w:num', { 'w:numId': '1' }, ['w:abstractNumId', { 'w:val': '1' }]]))
    before.maps.numbering.set('abstract:1', packJml(listDefinition('decimal', '1')))
    const after = { ...before, maps: { ...before.maps, numbering: new Map(before.maps.numbering).set('num:1',
      packJml(['w:num', { 'w:numId': '1' }, ['w:abstractNumId', { 'w:val': '1' }], ['w:lvlOverride', { 'w:ilvl': '0' }, ['w:startOverride', { 'w:val': '7' }]]])) } }
    const diff = diffDocxModels(before, after)
    expect(diff.identical).toBe(false)
    expect(diff.stories).toEqual([{ kind, id, change: 'modify', formats: [{ property: 'numPr', text: '', before: '1.', after: '7.', location: [{ kind: 'paragraph', index: 1 }] }], segments: [
      { op: 'delete', text: '1' }, { op: 'insert', text: '7' }, { op: 'equal', text: '. Story' },
    ] }])
  })

  it('pairs changed paragraphs, keeps added and removed ones, and notes formatting', async () => {
    const before = (await documentWith(p(run('Intro stays the same.')), p(run('This sentence will change a little.')), p(run('Removed paragraph entirely.')), p(run('Make me bold.')))).model
    const after = (await documentWith(p(run('Intro stays the same.')), p(run('This sentence will change quite a little.')), p(run('Brand new words here.')), p(run('Make me '), run('bold', 'b'), run('.')))).model
    const diff = diffDocxModels(before, after)
    expect(diff.blocks.map((block) => block.kind)).toEqual(['equal', 'modify', 'delete', 'insert', 'modify'])
    const changed = diff.blocks[1]!
    expect(changed.kind === 'modify' && changed.segments.filter((segment) => segment.op === 'insert').map((segment) => segment.text.trim())).toEqual(['quite'])
    const formatted = diff.blocks[4]!
    expect(formatted.kind === 'modify' && formatted.formats).toEqual([{ property: 'b', text: 'bold', before: undefined, after: 'on' }])
    expect(diff.stats).toMatchObject({ insertedBlocks: 1, deletedBlocks: 1, changedBlocks: 2 })
    expect(diff.identical).toBe(false)
    expect(diffDocxModels(before, before).identical).toBe(true)
  })
})

describe('editing commands', async () => {
  const { doc } = await documentWith(p(run('Hello world')), p(run('Second line')))
  const context = new DocxViewContext(doc)
  const state = (selectionFrom: number, selectionTo = selectionFrom) => {
    const base = EditorState.create({ schema, doc: readDocxModel(doc).body })
    return base.apply(base.tr.setSelection(TextSelection.create(base.doc, selectionFrom, selectionTo)))
  }

  it('toggles bold and sets sizes and alignment', () => {
    const bold = state(1, 6).apply(toggleRunProperty('b')(state(1, 6), context)!)
    expect(bold.doc.child(0).child(0).marks.map((mark) => mark.type.name)).toEqual(['b'])
    const unbold = bold.apply(toggleRunProperty('b')(bold, context)!)
    expect(unbold.doc.child(0).child(0).marks).toEqual([])
    const sized = state(1, 6).apply(setFontSize(14)(state(1, 6), context)!)
    expect(sized.doc.child(0).child(0).marks[0]!.attrs.v).toBe('["w:sz",{"w:val":"28"}]')
    const centered = state(3).apply(setAlignment('center')(state(3), context)!)
    expect(centered.doc.child(0).attrs.jc).toBe('["w:jc",{"w:val":"center"}]')
    const cleared = sized.apply(clearFormatting(sized.apply(sized.tr.setSelection(TextSelection.create(sized.doc, 1, 12))), context)!)
    expect(cleared.doc.child(0).child(0).marks).toEqual([])
  })

  it.each(['b', 'i'] as const)('toggles inherited character-style %s off and back on for selections and typing', async (name) => {
    const charStyle = schema.mark('rStyle', { v: packJml(['w:rStyle', { 'w:val': 'Emphasis' }]) })
    const { doc } = await documentWith(p(schema.text('Styled text', [charStyle])))
    doc.getMap('styles').set(...style('Emphasis', 'character', [['w:rPr', {}, [`w:${name}`, {}]]]))
    const context = new DocxViewContext(doc)
    try {
      for (const to of [3, 7]) {
        let state = EditorState.create({ schema, doc: readDocxModel(doc).body })
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, to)))
        const off = state.apply(toggleRunProperty(name)(state, context)!)
        expect(effectiveRunProperties(off, context).get(`w:${name}`)).toEqual([`w:${name}`, { 'w:val': '0' }])
        const on = off.apply(toggleRunProperty(name)(off, context)!)
        expect(effectiveRunProperties(on, context).get(`w:${name}`)).toEqual([`w:${name}`, {}])
      }
    } finally {
      context.destroy()
      doc.destroy()
    }
  })

  it('makes lists with real numbering definitions and turns them off again', () => {
    const result = toggleList('decimal', state(1, 14), context)!
    const listed = state(1, 14).apply(result.tr)
    expect(result.maps?.map(([map, key]) => `${map}/${key.split(':')[0]}`)).toEqual(['numbering/abstract', 'numbering/num'])
    expect(listed.doc.child(0).attrs.numPr).toContain('w:numId')
    expect(listed.doc.child(1).attrs.numPr).toBe(listed.doc.child(0).attrs.numPr)
  })

  it('allocates past a numbering map containing every former random id', async () => {
    const { doc } = await documentWith(p(run('List item')))
    doc.transact(() => {
      for (let id = 1000; id < 30000; id++) {
        doc.getMap('numbering').set(`abstract:${id}`, packJml(['w:abstractNum', { 'w:abstractNumId': String(id) }]))
        doc.getMap('numbering').set(`num:${id}`, packJml(['w:num', { 'w:numId': String(id) }]))
      }
    })
    const context = new DocxViewContext(doc)
    try {
      const state = EditorState.create({ schema, doc: readDocxModel(doc).body })
      const start = performance.now()
      const result = toggleList('bullet', state, context)!
      expect(performance.now() - start).toBeLessThan(1000)
      for (const [, key] of result.maps!) {
        expect(doc.getMap('numbering').has(key)).toBe(false)
        expect(Number(key.split(':')[1])).toBeGreaterThanOrEqual(30000)
        expect(Number(key.split(':')[1])).toBeLessThan(30000 + 2 ** 20)
      }
    } finally {
      context.destroy()
    }
  })

  it('keeps concurrently created list definitions distinct after replica sync', async () => {
    const { doc } = await documentWith(p(run('First')), p(run('Second')))
    const replicas = [new Y.Doc(), new Y.Doc()]
    const random = vi.spyOn(Math, 'random')
    try {
      for (const replica of replicas) Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
      const vector = Y.encodeStateVector(replicas[0]!)
      replicas.forEach((replica, index) => {
        random.mockReturnValue(index === 0 ? 0.25 : 0.75)
        const context = new DocxViewContext(replica)
        let state = EditorState.create({ schema, doc: readDocxModel(replica).body })
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, index === 0 ? 1 : 8)))
        const result = toggleList(index === 0 ? 'bullet' : 'decimal', state, context)!
        replica.transact(() => {
          for (const [map, key, value] of result.maps!) replica.getMap(map).set(key, value)
          writeFragment(replica, replica.getXmlFragment(BODY_FRAGMENT), result.tr.doc)
        })
        context.destroy()
      })
      const updates = replicas.map((replica) => Y.encodeStateAsUpdate(replica, vector))
      replicas.forEach((replica, index) => Y.applyUpdate(replica, updates[1 - index]!))
      for (const replica of replicas) {
        const context = new DocxViewContext(replica)
        expect([...replica.getMap('numbering').keys()].filter((key) => key.startsWith('num:'))).toHaveLength(2)
        expect(readDocxModel(replica).body.content.content.map((node) => {
          const num = JSON.parse(node.attrs.numPr as string) as JmlElement
          const id = (num[3] as JmlElement)[1]['w:val']!
          return context.numbering.level(id, 0)?.numFmt
        })).toEqual(['bullet', 'decimal'])
        context.destroy()
      }
    } finally {
      random.mockRestore()
      replicas.forEach((replica) => replica.destroy())
      doc.destroy()
    }
  })

  it('includes pending batch ids and stays bounded with a repeated random value', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      expect(freshId(['num:4', 'num:5', 'abstract:99'], 'num')).toBe('6')
      expect(random).toHaveBeenCalledTimes(1)
    } finally {
      random.mockRestore()
    }
  })

  it.each([
    ['İ foo bar', 'foo', false, 'İ X bar'],
    ['İ foo', 'foo', false, 'İ X'],
    ['AİBİC', 'i', false, 'AXBXC'],
    ['AİBİC', '̇bi̇', false, 'AXC'],
    ['😀İ AB', 'ab', false, '😀İ X'],
    ['İ ΟΣ', 'ΟΣ', false, 'İ X'],
    ['İ😀𐐀Z', '😀𐐨z', false, 'İX'],
    ['İx İ', 'i', true, 'İx X'],
  ])('finds original ranges in %s for %s (whole word %s)', async (text, query, wholeWord, expected) => {
    const { model } = await documentWith(p(run(text)))
    const state = EditorState.create({ schema, doc: model.body })
    const matches = findMatches(state.doc, query, { wholeWord })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every(({ from, to }) => from >= 1 && to <= state.doc.content.size && from < to)).toBe(true)
    expect(state.apply(replaceMatches(state, matches, 'X')).doc.textContent).toBe(expected)
  })

  it('maps sparse matches lazily after a long run of expanded characters', () => {
    const prefix = 'İ'.repeat(500_000)
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text(`${prefix} target`))])
    const start = performance.now()
    const matches = findMatches(doc, 'TARGET')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toEqual({ from: prefix.length + 2, to: prefix.length + 8 })
    expect(performance.now() - start).toBeLessThan(2_000)
  })

  it('validates supplied ranges again immediately before replacement', () => {
    const doc = schema.node('doc', null, [p(run('cat'))])
    const initial = EditorState.create({ schema, doc })
    const matches = findMatches(doc, 'cat')
    const changed = initial.apply(initial.tr.insertText('o', 2))
    const mapped = matches.map(({ from, to }) => ({ from, to: to + 1 }))
    expect(changed.apply(replaceMatches(changed, mapped, 'dog', 'cat')).doc.textContent).toBe('coat')
  })

  it('keeps original offsets across marked runs, atoms, and deleted text', () => {
    const doc = schema.node('doc', null, [p(run('İ '), run('foo', 'b'), schema.node('tab'), run('İ ', 'del'), run('foo'))])
    const state = EditorState.create({ schema, doc })
    const matches = findMatches(doc, 'foo')
    expect(matches.map(({ from, to }) => doc.textBetween(from, to)).join('|')).toBe('foo|foo')
    expect(state.apply(replaceMatches(state, matches, 'X')).doc.textContent).toBe('İ Xİ X')
  })

  it('inserts page breaks and finds and replaces text', () => {
    const broken = state(6).apply(insertPageBreak(state(6), context)!)
    expect(broken.doc.childCount).toBe(3)
    expect(broken.doc.child(0).lastChild!.type.name).toBe('break')
    const matches = findMatches(state(1).doc, 'LINE', { matchCase: false })
    expect(matches).toHaveLength(1)
    expect(findMatches(state(1).doc, 'LINE', { matchCase: true })).toHaveLength(0)
    expect(findMatches(state(1).doc, 'Sec', { wholeWord: true })).toHaveLength(0)
    const replaced = state(1).apply(replaceMatches(state(1), matches, 'row'))
    expect(replaced.doc.child(1).textContent).toBe('Second row')
    expect(wordCount(replaced.doc)).toMatchObject({ words: 4, paragraphs: 2 })
  })
})

describe('tracked changes', async () => {
  const { doc } = await documentWith(p(run('Hello world')))
  const reviewer = { author: 'Ada', date: '2026-11-04T10:00:00Z' }
  const initial = () => EditorState.create({ schema, doc: readDocxModel(doc).body })

  it('records typing as an insertion and deletion as a deletion', () => {
    const start = initial()
    const typed = start.apply(trackTransaction(start, start.tr.insertText(' brave', 6), reviewer)!)
    expect(typed.doc.textContent).toBe('Hello brave world')
    const inserted = typed.doc.child(0).child(1)
    expect(inserted.text).toBe(' brave')
    expect(inlineMarks(inserted).map((mark) => mark.type.name)).toContain('ins')

    const deleted = typed.apply(trackTransaction(typed, typed.tr.delete(13, 18), reviewer)!)
    expect(deleted.doc.textContent).toBe('Hello brave world')
    const revisions = listRevisions(deleted.doc)
    expect(revisions.map((revision) => [revision.kind, revision.text, revision.author])).toEqual([['insert', ' brave', 'Ada'], ['delete', 'world', 'Ada']])

    // Deleting your own insertion removes it for real.
    const undone = deleted.apply(trackTransaction(deleted, deleted.tr.delete(7, 12), reviewer)!)
    expect(undone.doc.textContent).toBe('Hello  world')
  })

  it.each(['accept', 'reject'] as const)('keeps original paragraph boundaries when resolving a fitted insertion with %s all', (action) => {
    const markRPr = packJml(['w:rPr', {}, ['w:b', {}]])
    const original = schema.node('doc', null, [schema.node('paragraph', { markRPr }, schema.text('ABC')), p(run('DEF'))])
    for (const pos of [1, 2, 4]) for (const clipboard of [false, true]) {
      let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
      const slice = new Slice(original.content, 0, 0)
      const tr = clipboard ? pasteSelection(state, slice) : state.tr.replaceSelection(slice)
      state = state.apply(trackTransaction(state, tr, reviewer)!)
      expect(listRevisions(state.doc).some(({ kind }) => kind === 'paragraphDelete')).toBe(false)
      const originalParagraph = state.doc.child(pos === 1 ? 2 : pos === 2 ? 3 : 0)
      expect(originalParagraph.attrs.markRPr).toBe(markRPr)
      state = state.apply(resolveRevisions(state, listRevisions(state.doc), action)!)
      const paragraphs: string[] = []
      state.doc.forEach((node) => paragraphs.push(node.textContent))
      expect(paragraphs).toEqual(action === 'reject' ? ['ABC', 'DEF']
        : pos === 1 ? ['ABC', 'DEF', 'ABC', 'DEF'] : pos === 2 ? ['A', 'ABC', 'DEF', 'BC', 'DEF'] : ['ABC', 'ABC', 'DEF', 'DEF'])
      if (action === 'reject') expect(state.doc.eq(original)).toBe(true)
      expect(listRevisions(state.doc)).toEqual([])
    }
  })

  it.each(['accept', 'reject'] as const)('preserves unselected paragraph marks in a fitted replacement with %s all', (action) => {
    const original = schema.node('doc', null, [p(run('ABC')), p(run('DEF'))])
    // Cover both fitted edges, whole paragraphs, and selections spanning an original mark.
    for (const [from, to] of [[2, 4], [1, 2], [1, 4], [2, 9], [1, 7]]) {
      let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from!, to!)))
      const tr = pasteSelection(state, new Slice(original.content, 0, 0))
      const editing = state.apply(tr)
      state = state.apply(trackTransaction(state, tr, reviewer)!)
      if (from === 2 && to === 4) {
        expect(listRevisions(state.doc).filter(({ kind }) => kind === 'delete').map(({ text }) => text)).toEqual(['BC'])
        expect(listRevisions(state.doc).some(({ kind }) => kind === 'paragraphDelete')).toBe(false)
      }
      state = state.apply(resolveRevisions(state, listRevisions(state.doc), action)!)
      const paragraphs = (doc: ProseMirrorNode) => Array.from({ length: doc.childCount }, (_, index) => doc.child(index).textContent)
      expect(paragraphs(state.doc)).toEqual(paragraphs(action === 'accept' ? editing.doc : original))
      expect(listRevisions(state.doc)).toEqual([])
    }
  })

  it.each([false, true])('rejects a closed paste after the final character without an empty paragraph (last mark first: %s)', (individual) => {
    const original = schema.node('doc', null, [p(run('ABC')), p(run('DEF'))])
    let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 9)))
    state = state.apply(trackTransaction(state, pasteSelection(state, new Slice(original.content, 0, 0)), reviewer)!)
    if (individual) {
      const last = listRevisions(state.doc).filter(({ kind }) => kind === 'paragraphInsert').at(-1)!
      state = state.apply(resolveRevisions(state, [last], 'reject')!)
    }
    state = state.apply(resolveRevisions(state, listRevisions(state.doc), 'reject')!)
    expect(state.doc.eq(original)).toBe(true)
    expect(listRevisions(state.doc)).toEqual([])
  })

  it.each(['accept', 'reject'] as const)('keeps an empty paragraph’s original mark after a fitted insertion and %s all', (action) => {
    const markRPr = packJml(['w:rPr', {}, ['w:i', {}]])
    const original = schema.node('doc', null, [schema.node('paragraph', { markRPr }), p(run('After'))])
    let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
    const slice = new Slice(Fragment.fromArray([p(run('ABC')), p(run('DEF'))]), 0, 0)
    state = state.apply(trackTransaction(state, pasteSelection(state, slice), reviewer)!)
    expect(listRevisions(state.doc).some(({ kind }) => kind === 'paragraphDelete')).toBe(false)
    expect(state.doc.child(1).attrs.markRPr).toBe(markRPr)
    state = state.apply(resolveRevisions(state, listRevisions(state.doc), action)!)
    if (action === 'reject') expect(state.doc.eq(original)).toBe(true)
    else expect(state.doc.childCount).toBe(3)
  })

  it('keeps the caret after each tracked keystroke', () => {
    let current = initial()
    current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, 6)))
    for (const char of ' new') {
      const tr = current.tr.insertText(char, current.selection.from)
      current = current.apply(trackTransaction(current, tr, reviewer)!)
    }
    expect(current.doc.textContent).toBe('Hello new world')
    expect(current.selection.from).toBe(10)
    expect(listRevisions(current.doc)).toHaveLength(1)
  })

  it('accepts and rejects', () => {
    const start = initial()
    const typed = start.apply(trackTransaction(start, start.tr.insertText('Oh, ', 1), reviewer)!)
    const deleted = typed.apply(trackTransaction(typed, typed.tr.delete(11, 16), reviewer)!)
    const accepted = deleted.apply(resolveRevisions(deleted, listRevisions(deleted.doc), 'accept')!)
    expect(accepted.doc.textContent).toBe('Oh, Hello ')
    expect(listRevisions(accepted.doc)).toEqual([])
    const rejected = deleted.apply(resolveRevisions(deleted, listRevisions(deleted.doc), 'reject')!)
    expect(rejected.doc.textContent).toBe('Hello world')
    expect(listRevisions(rejected.doc)).toEqual([])
  })

  it('records formatting and paragraph changes with what they replaced', () => {
    const start = initial()
    const bolded = start.apply(trackTransaction(start, start.tr.addMark(1, 6, schema.mark('b', { v: packJml(['w:b', {}]) })), reviewer)!)
    expect(listRevisions(bolded.doc).map((revision) => revision.kind)).toEqual(['format'])
    const rejected = bolded.apply(resolveRevisions(bolded, listRevisions(bolded.doc), 'reject')!)
    expect(rejected.doc.child(0).child(0).marks).toEqual([])
    const centered = start.apply(trackTransaction(start, start.tr.setNodeMarkup(0, undefined, { ...start.doc.child(0).attrs, jc: packJml(['w:jc', { 'w:val': 'center' }]) }), reviewer)!)
    expect(centered.doc.child(0).attrs.pPrChange).toContain('w:pPrChange')
    const restored = centered.apply(resolveRevisions(centered, listRevisions(centered.doc), 'reject')!)
    expect(restored.doc.child(0).attrs.jc).toBeNull()
  })

  it.each(['accept', 'reject'] as const)('resolves overlapping format-then-delete revisions with %s all', (action) => {
    const start = initial()
    const bolded = start.apply(trackTransaction(start, start.tr.addMark(1, 12, schema.mark('b', { v: packJml(['w:b', {}]) })), reviewer)!)
    const deleted = bolded.apply(trackTransaction(bolded, bolded.tr.delete(1, 12), reviewer)!)
    const resolved = deleted.apply(resolveRevisions(deleted, listRevisions(deleted.doc), action)!)
    expect(listRevisions(resolved.doc)).toEqual([])
    expect(resolved.doc.textContent).toBe(action === 'accept' ? '' : 'Hello world')
    if (action === 'reject') expect(resolved.doc.firstChild!.firstChild!.marks).toEqual([])
  })

  const table = () => schema.node('table', null, [schema.node('tableRow', null, [schema.node('tableCell', null, [p(run('Cell text'))])])])
  const tableCount = (doc: ProseMirrorNode) => {
    let count = 0
    doc.descendants((node) => { if (node.type.name === 'table') count++ })
    return count
  }

  it.each(['accept', 'reject'] as const)('resolves inserted table rows with %s all', (action) => {
    const start = initial()
    const context = new DocxViewContext(doc)
    const inserted = start.apply(trackTransaction(start, insertTable(2, 2)(start, context)!, reviewer)!)
    context.destroy()
    expect(listRevisions(inserted.doc).filter((revision) => revision.kind === 'rowInsert')).toHaveLength(2)
    const resolved = inserted.apply(resolveRevisions(inserted, listRevisions(inserted.doc), action)!)
    expect(listRevisions(resolved.doc)).toEqual([])
    expect(tableCount(resolved.doc)).toBe(action === 'accept' ? 1 : 0)
  })

  it.each(['accept', 'reject'] as const)('resolves deleted table rows with %s all', (action) => {
    const start = EditorState.create({ schema, doc: schema.node('doc', null, [table(), p(run('After'))]) })
    const deleted = start.apply(trackTransaction(start, start.tr.delete(0, start.doc.firstChild!.nodeSize), reviewer)!)
    expect(tableCount(deleted.doc)).toBe(1)
    expect(listRevisions(deleted.doc).some((revision) => revision.kind === 'rowDelete')).toBe(true)
    const resolved = deleted.apply(resolveRevisions(deleted, listRevisions(deleted.doc), action)!)
    expect(listRevisions(resolved.doc)).toEqual([])
    expect(tableCount(resolved.doc)).toBe(action === 'accept' ? 0 : 1)
    expect(resolved.doc.textContent).toBe(action === 'accept' ? 'After' : 'Cell textAfter')
  })

  it('tracks individual row insertion and deletion and exports pending row markup', async () => {
    const start = EditorState.create({ schema, doc: schema.node('doc', null, [table()]) })
    const row = table().firstChild!
    const inserted = start.apply(trackTransaction(start, start.tr.insert(1 + row.nodeSize, row), reviewer)!)
    expect(listRevisions(inserted.doc).filter((revision) => revision.kind === 'rowInsert')).toHaveLength(1)
    const rejected = inserted.apply(resolveRevisions(inserted, listRevisions(inserted.doc), 'reject')!)
    expect(rejected.doc.eq(start.doc)).toBe(true)
    const deleted = start.apply(trackTransaction(start, start.tr.delete(1, 1 + row.nodeSize), reviewer)!)
    const restored = deleted.apply(resolveRevisions(deleted, listRevisions(deleted.doc), 'reject')!)
    expect(restored.doc.eq(start.doc)).toBe(true)
    const assets = new MemoryAssetStore()
    const target = new Y.Doc()
    await docxCodec.createEmpty(target, { name: 'a.docx', assets })
    target.transact(() => writeFragment(target, target.getXmlFragment(BODY_FRAGMENT), inserted.doc))
    const { OoxmlPackage } = await import('../ooxml/package.js')
    const xml = OoxmlPackage.read(await docxCodec.exportFile(target, { name: 'a.docx', assets })).text('word/document.xml')!
    expect(xml).toMatch(/<w:trPr><w:ins w:id="\d+" w:author="Ada" w:date="2026-11-04T10:00:00Z"\/><\/w:trPr>/)
  })

  const mergedTable = () => {
    const cell = (text: string, rowspan = 1, colspan = 1) => schema.node('tableCell', { rowspan, colspan }, [p(run(text))])
    const row = (...cells: ProseMirrorNode[]) => schema.node('tableRow', null, cells)
    return schema.node('table', null, [row(cell('A', 2), cell('B')), row(cell('C')), row(cell('D'), cell('E'))])
  }

  it.each([addRowBefore, addRowAfter])('rejects a row inserted through a vertical merge', (command) => {
    let start = EditorState.create({ schema, doc: schema.node('doc', null, [mergedTable(), p(run('After'))]) })
    const pos = command === addRowBefore ? 1 + start.doc.firstChild!.firstChild!.nodeSize + 3 : 9
    start = start.apply(start.tr.setSelection(TextSelection.create(start.doc, pos)))
    let inserted = start
    command(start, (tr) => { inserted = start.apply(trackTransaction(start, tr, reviewer)!) })
    expect(inserted.doc.firstChild!.firstChild!.firstChild!.attrs.rowspan).toBe(3)
    const rejected = inserted.apply(resolveRevisions(inserted, listRevisions(inserted.doc), 'reject')!)
    expect(rejected.doc.eq(start.doc)).toBe(true)
    expect(TableMap.get(rejected.doc.firstChild!).width).toBe(2)
    expect(TableMap.get(rejected.doc.firstChild!).problems).toBeNull()
  })

  it.each([0, 1])('preserves merge geometry for pending deletion of row %i and resolves it', (rowIndex) => {
    let start = EditorState.create({ schema, doc: schema.node('doc', null, [mergedTable(), p(run('After'))]) })
    const pos = rowIndex === 0 ? 9 : 1 + start.doc.firstChild!.firstChild!.nodeSize + 3
    start = start.apply(start.tr.setSelection(TextSelection.create(start.doc, pos)))
    let expected = start
    let deleted = start
    deleteRow(start, (tr) => {
      expected = start.apply(tr)
      deleted = start.apply(trackTransaction(start, tr, reviewer)!)
    })
    expect(deleted.doc.firstChild!.firstChild!.firstChild!.attrs.rowspan).toBe(2)
    expect(TableMap.get(deleted.doc.firstChild!).problems).toBeNull()
    const rejected = deleted.apply(resolveRevisions(deleted, listRevisions(deleted.doc), 'reject')!)
    expect(rejected.doc.eq(start.doc)).toBe(true)
    const accepted = deleted.apply(resolveRevisions(deleted, listRevisions(deleted.doc), 'accept')!)
    expect(accepted.doc.eq(expected.doc)).toBe(true)
    expect(accepted.doc.firstChild!.firstChild!.firstChild!.textContent).toBe('A')
    expect(listRevisions(accepted.doc)).toEqual([])
    expect(TableMap.get(accepted.doc.firstChild!).width).toBe(2)
    expect(TableMap.get(accepted.doc.firstChild!).problems).toBeNull()
  })

  it.each(['editing', 'suggesting'] as const)('keeps the section end on the second paragraph after Enter in %s mode', async (mode) => {
    const sectPr = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'continuous' }]])
    const lead = packJml([['w:bookmarkStart', { 'w:id': '1', 'w:name': 'start' }]])
    const trail = packJml([['w:bookmarkEnd', { 'w:id': '1' }]])
    const { doc } = await documentWith(schema.node('paragraph', { sectPr, lead, trail, xmlAttrs: '{"w14:paraId":"12345678"}' }, schema.text('Hello world')))
    const context = new DocxViewContext(doc)
    const assets = new MemoryAssetStore()
    try {
      for (const pos of [1, 6, 12]) {
        let state = EditorState.create({ schema, doc: readDocxModel(doc).body })
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
        const tr = insertParagraphBreak(state, context)!
        state = state.apply(mode === 'suggesting' ? trackTransaction(state, tr, reviewer)! : tr)
        expect(state.doc.childCount).toBe(2)
        expect(state.doc.child(0).attrs).toMatchObject({ sectPr: null, trail: null })
        expect(state.doc.child(1).attrs).toMatchObject({ sectPr, trail, lead: null, xmlAttrs: null })
        if (mode === 'suggesting') {
          expect(listRevisions(state.doc).map(({ kind }) => kind)).toEqual(['paragraphInsert'])
          state = state.apply(resolveRevisions(state, listRevisions(state.doc), 'accept')!)
        }
        const target = new Y.Doc()
        await docxCodec.createEmpty(target, { name: 'a.docx', assets })
        target.transact(() => writeFragment(target, target.getXmlFragment(BODY_FRAGMENT), state.doc))
        const { OoxmlPackage } = await import('../ooxml/package.js')
        const xml = OoxmlPackage.read(await docxCodec.exportFile(target, { name: 'a.docx', assets })).text('word/document.xml')!
        // One paragraph section end and the final body section, as before Enter.
        expect(xml.match(/<w:sectPr[ >]/g)).toHaveLength(2)
        target.destroy()
      }
    } finally {
      context.destroy()
      doc.destroy()
    }
  })

  it.each([null, packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'nextPage' }]])])('rejects repeated Enter over an own inserted newline with section end %s', (sectPr) => {
    const context = new DocxViewContext(doc)
    try {
      const original = schema.node('doc', null, [schema.node('paragraph', { sectPr }, schema.text('ABC')), p(run('DEF'))])
      let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
      for (const [from, to] of [[1, 1], [1, 3]]) {
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from!, to!)))
        state = state.apply(trackTransaction(state, insertParagraphBreak(state, context)!, reviewer)!)
      }
      state = state.apply(resolveRevisions(state, listRevisions(state.doc), 'reject')!)
      expect(state.doc.eq(original)).toBe(true)
    } finally {
      context.destroy()
    }
  })

  it.each([null, 'w:ins', 'w:del'])('keeps original mark properties and %s through a tracked split over multiple paragraphs', (revision) => {
    const context = new DocxViewContext(doc)
    const markRPr = packJml(['w:rPr', {}, ['w:b', {}], ...(revision ? [[revision, { 'w:id': '42', 'w:author': 'Grace' }] as JmlElement] : [])])
    const sectPr = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'nextPage' }]])
    const original = schema.node('doc', null, [
      schema.node('paragraph', { markRPr, sectPr }, schema.text('ABC')),
      schema.node('paragraph', { markRPr: packJml(['w:rPr', {}, ['w:i', {}]]) }, schema.text('DEF')),
      p(run('GHI')),
    ])
    try {
      for (const [from, to] of [[1, 1], [2, 3], [2, 7], [2, 12]]) {
        let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from!, to!)))
        state = state.apply(trackTransaction(state, insertParagraphBreak(state, context)!, reviewer)!)
        const inserted = listRevisions(state.doc).filter(({ kind, author }) => kind === 'paragraphInsert' && author === reviewer.author)
        expect(inserted).toHaveLength(1)
        expect(state.doc.resolve(inserted[0]!.from).parent.attrs.sectPr).toBeNull()
        const paragraphs: ProseMirrorNode[] = []
        state.doc.forEach((node) => { if (node.attrs.sectPr) paragraphs.push(node) })
        expect(paragraphs).toHaveLength(1)
        expect(paragraphs[0]!.attrs.markRPr).toContain('w:b')
        const own = listRevisions(state.doc).filter(({ author }) => author === reviewer.author)
        state = state.apply(resolveRevisions(state, own, 'reject')!)
        expect(state.doc.eq(original)).toBe(true)
      }
    } finally {
      context.destroy()
    }
  })

  it('keeps the second inserted paragraph mark when rejecting only the first split', () => {
    let state = initial()
    for (const pos of [6, 10]) state = state.apply(trackTransaction(state, state.tr.split(pos), reviewer)!)
    const [first, second] = listRevisions(state.doc)
    state = state.apply(resolveRevisions(state, [first!], 'reject')!)
    expect(state.doc.childCount).toBe(2)
    expect(state.doc.child(0).textContent).toBe('Hello w')
    expect(state.doc.child(1).textContent).toBe('orld')
    expect(listRevisions(state.doc)).toHaveLength(1)
    expect(listRevisions(state.doc)[0]!.key.split(':')[1]).toBe(second!.key.split(':')[1])
    state = state.apply(resolveRevisions(state, listRevisions(state.doc), 'reject')!)
    expect(state.doc.eq(initial().doc)).toBe(true)
    expect(listRevisions(state.doc)).toEqual([])
  })

  it.each(['accept', 'reject'] as const)('keeps the surviving mark and section end when revisions join paragraphs on %s', (action) => {
    const name = action === 'reject' ? 'w:ins' : 'w:del'
    const markRPr = packJml(['w:rPr', {}, ['w:b', {}], ['w:ins', { 'w:id': '42', 'w:author': 'Grace' }]])
    const sectPr = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'continuous' }]])
    const trail = packJml([['w:bookmarkEnd', { 'w:id': '1' }]])
    const first = schema.node('paragraph', { markRPr: packJml(['w:rPr', {}, [name, { 'w:id': '41', 'w:author': 'Ada' }]]) }, schema.text('Hello'))
    const second = schema.node('paragraph', { markRPr, sectPr, trail }, schema.text(' world'))
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [first, second]) })
    const joined = state.apply(resolveRevisions(state, [listRevisions(state.doc)[0]!], action)!)
    expect(joined.doc.firstChild!.attrs).toMatchObject({ markRPr, sectPr, trail })
    expect(listRevisions(joined.doc).map(({ kind, author }) => ({ kind, author }))).toEqual([{ kind: 'paragraphInsert', author: 'Grace' }])
  })

  it.each(['accept', 'reject'] as const)('resolves cross-paragraph deletions with %s without inserting fitting shells', (action) => {
    const context = new DocxViewContext(doc)
    const sectPr = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'nextPage' }]])
    const markRPr = packJml(['w:rPr', {}, ['w:i', {}]])
    const original = schema.node('doc', null, [p(run('ABC')), schema.node('paragraph', { sectPr, markRPr }, schema.text('DEF')), p(run('GHI'))])
    try {
      for (const enter of [false, true]) for (const [from, to] of [[1, 7], [2, 7], [1, 12]]) {
        let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from!, to!)))
        const tr = enter ? insertParagraphBreak(state, context)! : state.tr.deleteSelection()
        const expected = state.apply(tr).doc
        state = state.apply(trackTransaction(state, tr, reviewer)!)
        expect(listRevisions(state.doc).filter(({ kind }) => kind === 'paragraphInsert')).toHaveLength(enter ? 1 : 0)
        state = state.apply(resolveRevisions(state, listRevisions(state.doc), action)!)
        expect(state.doc.eq(action === 'accept' ? expected : original)).toBe(true)
        expect(listRevisions(state.doc)).toEqual([])
      }
    } finally {
      context.destroy()
    }
  })

  it('records Enter as an inserted paragraph mark', () => {
    const start = initial()
    const split = start.apply(trackTransaction(start, start.tr.split(6), reviewer)!)
    expect(split.doc.childCount).toBe(2)
    expect(split.doc.child(0).attrs.markRPr).toContain('w:ins')
    const rejected = split.apply(resolveRevisions(split, listRevisions(split.doc), 'reject')!)
    expect(rejected.doc.childCount).toBe(1)
    expect(rejected.doc.textContent).toBe('Hello world')
  })

  it('removes an own inserted paragraph mark on join without changing the original paragraphs', async () => {
    const original = schema.node('doc', null, [p(run('Hello world')), p(run('Another paragraph'))])
    const start = EditorState.create({ schema, doc: original })
    const split = start.apply(trackTransaction(start, start.tr.split(6), reviewer)!)
    const joined = split.apply(trackTransaction(split, split.tr.join(7), reviewer)!)
    expect(listRevisions(joined.doc)).toEqual([])
    expect(joined.doc.eq(original)).toBe(true)
    const rejected = resolveRevisions(joined, listRevisions(joined.doc), 'reject')
    const final = rejected ? joined.apply(rejected) : joined
    expect(final.doc.eq(original)).toBe(true)

    const target = new Y.Doc()
    const assets = new MemoryAssetStore()
    await docxCodec.createEmpty(target, { name: 'a.docx', assets })
    target.transact(() => writeFragment(target, target.getXmlFragment(BODY_FRAGMENT), final.doc))
    const imported = new Y.Doc()
    await docxCodec.importFile(imported, await docxCodec.exportFile(target, { name: 'a.docx', assets }), { name: 'a.docx', assets })
    const paragraphs: string[] = []
    readDocxModel(imported).body.forEach((node) => paragraphs.push(node.textContent))
    expect(paragraphs).toEqual(['Hello world', 'Another paragraph'])
    target.destroy()
    imported.destroy()
  })

  it.each(['w:ins', 'w:del'])('keeps the surviving paragraph mark formatting and %s on an own-insertion join', (revision) => {
    const markRPr = packJml(['w:rPr', {}, ['w:b', {}], [revision, { 'w:id': '42', 'w:author': 'Grace' }]])
    const first = schema.node('paragraph', { markRPr: packJml(['w:rPr', {}, ['w:ins', { 'w:id': '41', 'w:author': 'Ada' }]]) }, schema.text('Hello'))
    const second = schema.node('paragraph', { markRPr }, schema.text(' world'))
    const start = EditorState.create({ schema, doc: schema.node('doc', null, [first, second, p(run('Another paragraph'))]) })
    const joined = start.apply(trackTransaction(start, start.tr.join(first.nodeSize), reviewer)!)
    expect(joined.doc.firstChild!.attrs.markRPr).toBe(markRPr)
    expect(listRevisions(joined.doc).map(({ kind, author }) => ({ kind, author }))).toEqual([{ kind: revision === 'w:ins' ? 'paragraphInsert' : 'paragraphDelete', author: 'Grace' }])
  })

  it('exports tracked edits as Word revision markup', async () => {
    const start = initial()
    const typed = start.apply(trackTransaction(start, start.tr.insertText('New ', 1), reviewer)!)
    const deleted = typed.apply(trackTransaction(typed, typed.tr.delete(11, 16), reviewer)!)
    const target = new Y.Doc()
    const assets = new MemoryAssetStore()
    await docxCodec.createEmpty(target, { name: 'a.docx', assets })
    target.transact(() => writeFragment(target, target.getXmlFragment(BODY_FRAGMENT), deleted.doc))
    const bytes = await docxCodec.exportFile(target, { name: 'a.docx', assets })
    const { OoxmlPackage } = await import('../ooxml/package.js')
    const xml = OoxmlPackage.read(bytes).text('word/document.xml')!
    expect(xml).toMatch(/<w:ins w:id="\d+" w:author="Ada" w:date="2026-11-04T10:00:00Z"><w:r><w:t xml:space="preserve">New <\/w:t><\/w:r><\/w:ins>/)
    expect(xml).toMatch(/<w:del w:id="\d+" w:author="Ada" w:date="2026-11-04T10:00:00Z"><w:r><w:delText>world<\/w:delText><\/w:r><\/w:del>/)
  })
})

describe('section ends', () => {
  const sectPr = packJml(['w:sectPr', {}, ['w:pgSz', { 'w:w': '15840', 'w:h': '12240', 'w:orient': 'landscape' }]])
  const paragraph = (text: string, section: string | null = null, pStyle: string | null = null) => schema.node('paragraph', { sectPr: section, pStyle }, schema.text(text))

  it.each([joinBackward, joinForward])('keeps the surviving section end on a keyboard join and in the same undo event', (command) => {
    const original = schema.node('doc', null, [paragraph('A', null, 'Heading1'), paragraph('B', sectPr, 'Normal'), paragraph('C')])
    let state = EditorState.create({ schema, doc: original, plugins: [history(), sectionEndsPlugin()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, command === joinBackward ? 4 : 2)))
    expect(command(state, (tr) => { state = state.apply(tr) })).toBe(true)
    expect(state.doc.child(0).textContent).toBe('AB')
    expect(state.doc.child(0).attrs).toMatchObject({ sectPr, pStyle: 'Heading1' })
    expect(undo(state, (tr) => { state = state.apply(tr) })).toBe(true)
    expect(state.doc.eq(original)).toBe(true)
  })

  it('does not let Reject All remove an original end after an Editing join of a suggested split', () => {
    const doc = new Y.Doc()
    const context = new DocxViewContext(doc)
    try {
      const original = schema.node('doc', null, [paragraph('AlphaBravoCharlie', sectPr), paragraph('Final')])
      const reviewer = { author: 'Ada', date: '2026-11-04T10:00:00Z' }
      let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)))
      state = state.apply(trackTransaction(state, insertParagraphBreak(state, context)!, reviewer)!)
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8)))
      expect(joinBackward(state, (tr) => { state = state.apply(tr) })).toBe(true)
      expect(state.doc.eq(original)).toBe(true)
      expect(listRevisions(state.doc)).toEqual([])
      expect(resolveRevisions(state, listRevisions(state.doc), 'reject')).toBeNull()
    } finally {
      context.destroy()
      doc.destroy()
    }
  })

  it.each([null, 'w:ins', 'w:del'])('restores exactly the surviving end’s mark properties (%s) across multiple steps', (revision) => {
    const markRPr = revision ? packJml(['w:rPr', {}, ['w:b', {}], [revision, { 'w:id': '42', 'w:author': 'Grace' }]]) : null
    const original = schema.node('doc', null, [
      schema.node('paragraph', { markRPr: packJml(['w:rPr', {}, ['w:i', {}]]) }, schema.text('A')),
      schema.node('paragraph', { markRPr, sectPr }, schema.text('B')),
      paragraph('Final'),
    ])
    const state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
    const next = state.apply(state.tr.insertText('x', 1).join(4).insertText('y', 1))
    expect(next.doc.firstChild!.textContent).toBe('yxAB')
    expect(next.doc.firstChild!.attrs).toMatchObject({ markRPr, sectPr })
  })

  it.each(['editing', 'suggesting'] as const)('shares Enter’s mark ownership with page and section breaks in %s mode', (mode) => {
    const doc = new Y.Doc()
    const context = new DocxViewContext(doc)
    const markRPr = packJml(['w:rPr', {}, ['w:b', {}], ['w:ins', { 'w:id': '42', 'w:author': 'Grace' }]])
    const reviewer = { author: 'Ada', date: '2026-11-04T10:00:00Z' }
    try {
      for (const pos of [1, 2, 4]) for (const section of [false, true]) {
        let state = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', { sectPr, markRPr }, schema.text('ABC')), paragraph('Final')]), plugins: [sectionEndsPlugin()] })
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
        const tr = section ? insertSectionBreak('continuous', state, context)!.tr : insertPageBreak(state, context)!
        state = state.apply(mode === 'suggesting' ? trackTransaction(state, tr, reviewer)! : tr)
        expect(state.doc.child(0).attrs.sectPr !== null).toBe(section)
        expect(state.doc.child(1).attrs.sectPr).not.toBeNull()
        expect(state.doc.child(1).attrs.markRPr).toBe(markRPr)
        expect(state.doc.child(0).attrs.markRPr).not.toBe(markRPr)
        if (mode === 'suggesting') expect(state.doc.child(0).attrs.markRPr).toContain('Ada')
        else expect(state.doc.child(0).attrs.markRPr).toBeNull()
        if (section) {
          expect(state.doc.child(1).attrs.sectPr, `section at ${pos} in ${mode}`).toContain('continuous')
          expect(state.doc.child(0).attrs.sectPr).toBe(sectPr)
        }
      }
    } finally {
      context.destroy()
      doc.destroy()
    }
  })

  it('keeps an empty paragraph’s original end after an inserted table', () => {
    const doc = new Y.Doc()
    const context = new DocxViewContext(doc)
    const markRPr = packJml(['w:rPr', {}, ['w:b', {}], ['w:del', { 'w:id': '42', 'w:author': 'Grace' }]])
    try {
      const state = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', { sectPr, markRPr }), paragraph('Final')]), plugins: [sectionEndsPlugin()] })
      const next = state.apply(insertTable(2, 2)(state, context)!)
      expect(next.doc.child(0).type.name).toBe('table')
      expect(next.doc.child(1).attrs).toMatchObject({ sectPr, markRPr })
      expect(next.doc.child(2).textContent).toBe('Final')
    } finally {
      context.destroy()
      doc.destroy()
    }
  })

  it('skips paragraph traversal for inline replacement in a 40,000-paragraph document', () => {
    const doc = schema.node('doc', null, Array.from({ length: 40_000 }, () => paragraph('Paragraph text.')))
    const state = EditorState.create({ schema, doc, plugins: [sectionEndsPlugin()] })
    const tr = state.tr.insertText('x', 2, 3)
    const between = vi.spyOn(doc, 'nodesBetween')
    const descendants = vi.spyOn(doc, 'descendants')
    try {
      state.apply(tr)
      expect(between).not.toHaveBeenCalled()
      expect(descendants).not.toHaveBeenCalled()
    } finally {
      between.mockRestore()
      descendants.mockRestore()
    }
  })

  it('keeps the last paragraph section end when a selection deletes from A into C', () => {
    const original = schema.node('doc', null, [paragraph('AAA', null, 'Heading1'), paragraph('BBB'), paragraph('CCC', sectPr)])
    const state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
    const next = state.apply(state.tr.delete(2, 13))
    expect(next.doc.childCount).toBe(1)
    expect(next.doc.firstChild!.textContent).toBe('AC')
    expect(next.doc.firstChild!.attrs).toMatchObject({ sectPr, pStyle: 'Heading1' })
  })

  it('drops a section break when its paragraph end is deleted', () => {
    const original = schema.node('doc', null, [paragraph('AAA', sectPr), paragraph('BBB'), paragraph('CCC')])
    const state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
    const next = state.apply(state.tr.delete(2, 13))
    expect(next.doc.firstChild!.textContent).toBe('AC')
    expect(next.doc.firstChild!.attrs.sectPr).toBeNull()
  })

  it('replaces an inherited section break with the surviving end’s different break', () => {
    const other = packJml(['w:sectPr', {}, ['w:type', { 'w:val': 'continuous' }]])
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph('A', other), paragraph('B', sectPr)]), plugins: [sectionEndsPlugin()] })
    const next = state.apply(state.tr.join(3))
    expect(next.doc.firstChild!.attrs.sectPr).toBe(sectPr)
  })

  it('leaves new split ends empty and new pasted ends with their own section properties', () => {
    const doc = new Y.Doc()
    const context = new DocxViewContext(doc)
    try {
      let state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph('ABC', sectPr)]), plugins: [sectionEndsPlugin()] })
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
      state = state.apply(insertParagraphBreak(state, context)!)
      expect(state.doc.child(0).attrs.sectPr).toBeNull()
      expect(state.doc.child(1).attrs.sectPr).toBe(sectPr)
      const next = state.apply(state.tr.insert(0, paragraph('Pasted', sectPr)))
      expect(next.doc.child(0).attrs.sectPr).toBe(sectPr)
      expect(next.doc.child(1).attrs.sectPr).toBeNull()
      expect(next.doc.child(2).attrs.sectPr).toBe(sectPr)
    } finally {
      context.destroy()
      doc.destroy()
    }
  })

  it.each(['editing', 'suggesting'] as const)('assigns pasted marks to new ends and preserves the original end in %s mode', async (mode) => {
    const markRPr = packJml(['w:rPr', {}, ['w:b', {}], ['w:ins', { 'w:id': '42', 'w:author': 'Grace' }]])
    const reviewer = { author: 'Ada', date: '2026-11-04T10:00:00Z' }
    const original = schema.node('doc', null, [schema.node('paragraph', { sectPr, markRPr }, schema.text('ABC'))])
    for (const closed of [false, true]) for (const own of [false, true]) for (const pos of closed ? [2] : [1, 2, 4]) {
      let state = EditorState.create({ schema, doc: original, plugins: [history(), sectionEndsPlugin()] })
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
      const attrs = own ? { sectPr, markRPr } : null
      const slice = new Slice(Fragment.fromArray([schema.node('paragraph', attrs, schema.text('xy')), paragraph('zz')]), closed ? 0 : 1, closed ? 0 : 1)
      const tr = pasteSelection(state, slice)
      state = state.apply(mode === 'suggesting' ? trackTransaction(state, tr, reviewer)! : tr)
      const paragraphs: ProseMirrorNode[] = []
      state.doc.forEach((node) => { paragraphs.push(node) })
      const surviving = state.doc.resolve(tr.mapping.map(4)).parent
      expect(surviving.attrs).toMatchObject({ sectPr, markRPr })
      for (const node of paragraphs.filter((node) => node !== surviving)) {
        const copied = own && node.textContent.endsWith('xy')
        expect(node.attrs.sectPr).toBe(copied ? sectPr : null)
        if (copied) expect(node.attrs.markRPr).toBe(markRPr)
        else if (mode === 'editing') expect(node.attrs.markRPr).toBeNull()
        else {
          expect(node.attrs.markRPr).toContain('Ada')
          expect(node.attrs.markRPr).not.toContain('Grace')
        }
      }
      if (!closed && !own && pos === 2) {
        expect(paragraphs.map((node) => node.textContent)).toEqual(['Axy', 'zzBC'])
        const target = new Y.Doc()
        const assets = new MemoryAssetStore()
        try {
          await docxCodec.createEmpty(target, { name: 'a.docx', assets })
          target.transact(() => writeFragment(target, target.getXmlFragment(BODY_FRAGMENT), state.doc))
          const { OoxmlPackage } = await import('../ooxml/package.js')
          const xml = OoxmlPackage.read(await docxCodec.exportFile(target, { name: 'a.docx', assets })).text('word/document.xml')!
          expect(xml.match(/<w:sectPr[ >]/g)).toHaveLength(2)
        } finally {
          target.destroy()
        }
      }
      if (mode === 'editing') {
        expect(undo(state, (tr) => { state = state.apply(tr) })).toBe(true)
        expect(state.doc.eq(original)).toBe(true)
      }
    }
  })

  it.each(['editing', 'suggesting'] as const)('keeps a copied empty paragraph mark in %s mode', (mode) => {
    const markRPr = packJml(['w:rPr', {}, ['w:ins', { 'w:id': '42', 'w:author': 'Grace' }]])
    let state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph('ABC', sectPr)]), plugins: [sectionEndsPlugin()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
    const slice = new Slice(Fragment.fromArray([schema.node('paragraph', { sectPr, markRPr }), schema.node('paragraph')]), 1, 1)
    const tr = pasteSelection(state, slice)
    state = state.apply(mode === 'suggesting' ? trackTransaction(state, tr, { author: 'Ada', date: '2026-11-04T10:00:00Z' })! : tr)
    expect(state.doc.firstChild!.attrs).toMatchObject({ sectPr, markRPr })
    expect(state.doc.lastChild!.attrs).toMatchObject({ sectPr, markRPr: null })
  })

  it.each([joinBackward, joinForward])('keeps deleted marks and their sections while suggesting a keyboard join', (command) => {
    const original = schema.node('doc', null, [paragraph('A', sectPr), paragraph('B')])
    let state = EditorState.create({ schema, doc: original, plugins: [sectionEndsPlugin()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, command === joinBackward ? 4 : 2)))
    const reviewer = { author: 'Ada', date: '2026-11-04T10:00:00Z' }
    expect(command(state, (tr) => { state = state.apply(trackTransaction(state, tr, reviewer)!) })).toBe(true)
    expect(state.doc.childCount).toBe(2)
    expect(state.doc.child(0).attrs.sectPr).toBe(sectPr)
    expect(state.doc.child(1).attrs.sectPr).toBeNull()
    expect(listRevisions(state.doc).map(({ kind }) => kind)).toEqual(['paragraphDelete'])
    const accepted = state.apply(resolveRevisions(state, listRevisions(state.doc), 'accept')!)
    expect(accepted.doc.childCount).toBe(1)
    expect(accepted.doc.firstChild!.attrs.sectPr).toBeNull()
    const rejected = state.apply(resolveRevisions(state, listRevisions(state.doc), 'reject')!)
    expect(rejected.doc.eq(original)).toBe(true)
  })

  it('retains new pasted paragraph ends in suggesting mode', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph('Original')]), plugins: [sectionEndsPlugin()] })
    const reviewer = { author: 'Ada', date: '2026-11-04T10:00:00Z' }
    const next = state.apply(trackTransaction(state, state.tr.insert(0, paragraph('Pasted', sectPr)), reviewer)!)
    expect(next.doc.child(0).attrs.sectPr).toBe(sectPr)
    expect(next.doc.child(1).attrs.sectPr).toBeNull()
    expect(listRevisions(next.doc).map(({ kind }) => kind)).toContain('paragraphInsert')
  })

  it('does not restore section ends for y-sync transactions', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph('A'), paragraph('B', sectPr)]), plugins: [sectionEndsPlugin()] })
    const next = state.apply(state.tr.join(3).setMeta(ySyncPluginKey, { isChangeOrigin: true }))
    expect(next.doc.firstChild!.attrs.sectPr).toBeNull()
  })
})
