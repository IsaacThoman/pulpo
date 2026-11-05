import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
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
import { clearFormatting, freshId, findMatches, insertTable, insertPageBreak, listDefinition, replaceMatches, setAlignment, setFontSize, toggleList, toggleRunProperty, wordCount } from './view/commands.js'
import { DocxViewContext } from './view/context.js'
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
