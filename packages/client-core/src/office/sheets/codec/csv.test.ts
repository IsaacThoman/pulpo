import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { SheetCalc } from '../calc.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetCodec } from './codec.js'
import { decodeText, encodeText, parseCsv, sniffDelimiter } from './csv.js'

const codec = new SheetCodec()
const assets = new MemoryLiveAssetStore()

async function roundTrip(bytes: Uint8Array, name = 'data.csv'): Promise<{ output: Uint8Array; doc: Y.Doc }> {
  const doc = new Y.Doc()
  await codec.importFile(doc, bytes, { name, assets })
  return { output: await codec.exportFile(doc, { name, assets }), doc }
}

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('csv codec', () => {
  const unchanged: [string, Uint8Array, string?][] = [
    ['simple LF', utf8('a,b,c\n1,2,3\n')],
    ['CRLF without trailing newline', utf8('a,b\r\n1,2')],
    ['CR only', utf8('a,b\r1,2\r')],
    ['quoted fields with delimiters, quotes, and newlines', utf8('name,note\n"Smith, J","He said ""hi""\nthen left"\n')],
    ['needlessly quoted fields', utf8('"a","b"\n"1","x"\n')],
    ['numbers that are not canonical', utf8('id,price\n007,1.50\n1e3,-0\n')],
    ['ragged rows and empty trailing fields', utf8('a,b,c\n1\n2,,\n,,,\n')],
    ['blank lines', utf8('a\n\nb\n')],
    ['fully quoted fields with a blank record', utf8('"a"\n\n')],
    ['quoted empty fields and blank records', utf8('"a",""\n\n"","b"\n\n')],
    ['leading blank records in a quoted file', utf8('\n\n"a"\n""\n')],
    ['quoted records with mixed blank line endings', utf8('"a"\r\n\n""\r\n\r\n')],
    ['quoted fields and unquoted trailing empty fields', utf8('"a",\n,"b"\n\n')],
    ['quoted blank fields without a trailing newline', utf8('"a"\n\n""')],
    ['semicolons', utf8('a;b;c\n1,5;2,5;3\n')],
    ['UTF-8 BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('é,ü\n')])],
    ['UTF-16LE BOM', encodeText('x,ÿ\r\n1,2\r\n', { encoding: 'utf-16le', bom: true })],
    ['Windows-1252', new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x2c, 0x80, 0x0a])],
    ['only a header', utf8('a,b,c\n')],
    ['empty file', new Uint8Array()],
    ['tabs', utf8('a\tb\n1\t"x\ty"\n'), 'data.tsv'],
  ]
  for (const [label, bytes, name] of unchanged) {
    it(`writes back ${label} byte for byte`, async () => {
      const { output } = await roundTrip(bytes, name)
      expect(Buffer.from(output).toString('hex')).toBe(Buffer.from(bytes).toString('hex'))
    })
  }

  it('reads numbers as numbers and keeps text as text', async () => {
    const { doc } = await roundTrip(utf8('a,b,c\n12,007,x\n'))
    const sheet = new WorkbookModel(doc).sheets()[0]!
    expect(sheet.cell(1, 0)).toEqual({ v: 12 })
    expect(sheet.cell(1, 1)).toEqual({ v: 7, raw: '007' })
    expect(sheet.cell(1, 2)).toEqual({ v: 'x' })
  })

  it('writes edits in the original dialect', async () => {
    const doc = new Y.Doc()
    await codec.importFile(doc, utf8('"a";"b"\r\n"1";"2"\r\n'), { name: 'x.csv', assets })
    const sheet = new WorkbookModel(doc).sheets()[0]!
    sheet.setCell(1, 1, { v: 'semi;colon' })
    sheet.setCell(2, 0, { v: 3.5 })
    expect(new TextDecoder().decode(await codec.exportFile(doc, { name: 'x.csv', assets }))).toBe('"a";"b"\r\n"1";"semi;colon"\r\n"3.5";""\r\n')
  })

  it('keeps blank records empty for calculation while retaining the quoting policy for new cells', async () => {
    const { doc } = await roundTrip(utf8('"a"\n\n'))
    const sheet = new WorkbookModel(doc).sheets()[0]!
    const calc = new SheetCalc(sheet.workbook, { live: false })
    expect(calc.get(sheet, 1, 0)).toBe(null)
    expect(calc.evaluate(sheet, 0, 1, 'COUNTA(A1:A2)')).toBe(1)
    sheet.setCell(2, 0, { v: 'new' })
    expect(await codec.exportFile(doc, { name: 'data.csv', assets })).toEqual(utf8('"a"\n\n"new"\n'))
    calc.destroy()
  })

  it('keeps text that no longer fits Windows-1252 by switching to UTF-8', async () => {
    const doc = new Y.Doc()
    await codec.importFile(doc, new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]), { name: 'x.csv', assets })
    new WorkbookModel(doc).sheets()[0]!.setCell(0, 0, { v: '日本' })
    const output = await codec.exportFile(doc, { name: 'x.csv', assets })
    expect(decodeText(output)).toMatchObject({ text: '日本\n', encoding: 'utf-8', bom: true })
  })

  it('exports an xlsx workbook as CSV of its first sheet', async () => {
    const doc = new Y.Doc()
    await codec.createEmpty(doc, { name: 'Book.xlsx', assets })
    const sheet = new WorkbookModel(doc).sheets()[0]!
    sheet.setCell(0, 0, { v: 'x' })
    sheet.setCell(0, 1, { v: 1e21 })
    sheet.setCell(1, 0, { v: true })
    expect(new TextDecoder().decode(await codec.exportFile(doc, { name: 'Book.csv', assets }))).toBe('x,1E+21\r\nTRUE,\r\n')
  })

  it('sniffs the delimiter', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3\n')).toBe(';')
    expect(sniffDelimiter('a\tb\n1\t2\n')).toBe('\t')
    expect(sniffDelimiter('a,b\n"1;2",3\n')).toBe(',')
    expect(sniffDelimiter('a|b|c\n1|2|3')).toBe('|')
  })

  it('parses quoted fields across lines', () => {
    expect(parseCsv('"a\nb",c\r\nd', ',').rows.map((row) => row.fields)).toEqual([['a\nb', 'c'], ['d']])
  })

  it('refuses files past the size limits', async () => {
    const huge = utf8(`${'x'.repeat(300_000)}\n`)
    await expect(codec.importFile(new Y.Doc(), huge, { name: 'x.csv', assets })).rejects.toMatchObject({ code: 'too_large' })
  })

  it('shows CSV text as is for agents', async () => {
    const { doc } = await roundTrip(utf8('a,b\n1,"x,y"\n'))
    expect(codec.toText(doc)).toBe('a\tb\n1\tx,y')
  })
})

describe('csv row shapes after edits', () => {
  const edited = async (text: string, edit: (sheet: ReturnType<WorkbookModel['sheets']>[number]) => void) => {
    const doc = new Y.Doc()
    await codec.importFile(doc, utf8(text), { name: 'data.csv', assets })
    doc.transact(() => edit(new WorkbookModel(doc).sheets()[0]!))
    return new TextDecoder().decode(await codec.exportFile(doc, { name: 'data.csv', assets }))
  }

  it('widens every row of a rectangular file when a value goes into a new column', async () => {
    expect(await edited('a,b\n1,2\n3,4\n', (sheet) => sheet.setCell(1, 2, { v: 'x' }))).toBe('a,b,\n1,2,x\n3,4,\n')
  })

  it('keeps the width of ragged rows that nobody widened', async () => {
    expect(await edited('a,b,c\n1\n2,3,4\n', (sheet) => sheet.setCell(2, 3, { v: 'x' }))).toBe('a,b,c,\n1\n2,3,4,x\n')
  })

  it('drops deleted columns, including an empty trailing one', async () => {
    const { deleteAxis } = await import('../model/structure.js')
    expect(await edited('a,b\nc,d\n', (sheet) => deleteAxis(sheet, 'col', 1, 1))).toBe('a\nc\n')
    expect(await edited('a,b,\nc,d,\n', (sheet) => deleteAxis(sheet, 'col', 2, 1))).toBe('a,b\nc,d\n')
  })
})

describe('csv structural file merges', () => {
  const cases = [
    ['a row inserted first', 'alpha\nbeta\ngamma\n', 'new\nalpha\nbeta\ngamma\n'],
    ['a column inserted first', 'alpha,beta,gamma\n', 'new,alpha,beta,gamma\n'],
    ['a row inserted before trailing blank records', 'alpha,beta,gamma\na\n\n', 'new,row,here\nalpha,beta,gamma\na\n\n'],
    ['a column inserted before ragged rows', 'alpha,beta,gamma\na\nb,c\n', 'new,alpha,beta,gamma\nx,a\ny,b,c\n'],
    ['trailing empty columns after a column insert', 'alpha,beta,gamma,\na,b,c,\n', 'new,alpha,beta,gamma,\nx,a,b,c,\n'],
  ] as const
  for (const [label, before, incoming] of cases) {
    it(`writes the incoming bytes exactly with ${label}`, async () => {
      const context = { name: 'data.csv', assets }
      const doc = new Y.Doc()
      await codec.importFile(doc, utf8(before), context)
      expect((await codec.applyFile(doc, utf8(incoming), context)).changed).toBe(true)
      expect(await codec.exportFile(doc, context)).toEqual(utf8(incoming))
      expect((await codec.applyFile(doc, utf8(incoming), context)).changed).toBe(false)
      expect(await codec.exportFile(doc, context)).toEqual(utf8(incoming))
    })
  }
})

describe('csv merge replication', () => {
  for (const count of [2, 3]) for (const descending of [false, true]) for (const reverse of [false, true]) {
    const clientIds = Array.from({ length: count }, (_, index) => index + 1)
    if (descending) clientIds.reverse()
    const label = `clients ${clientIds}, ${reverse ? 'reverse' : 'forward'} delivery`

    for (const axis of ['row', 'col'] as const) {
      it(`keeps incoming CSV shape and concurrent values after a ${axis} insert (${label})`, async () => {
        const separator = axis === 'row' ? '\n' : ','
        const before = ['alpha', 'beta', 'gamma'].join(separator) + '\n'
        const incoming = ['new', 'alpha', 'beta', 'gamma'].join(separator) + '\n'
        const base = new Y.Doc()
        base.clientID = 100
        const context = { name: 'data.csv', assets }
        await codec.importFile(base, utf8(before), context)
        const docs = clientIds.map((clientID) => {
          const doc = new Y.Doc()
          doc.clientID = clientID
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
          return doc
        })
        await codec.applyFile(docs[0]!, utf8(incoming), context)
        for (let index = 1; index < count; index++) {
          const sheet = new WorkbookModel(docs[index]!).sheets()[0]!
          sheet.setCell(axis === 'row' ? index : 0, axis === 'col' ? index : 0, { v: index === 1 ? 'BETA' : 'GAMMA' })
        }
        const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc))
        if (reverse) updates.reverse()
        for (const doc of docs) for (const update of updates) Y.applyUpdate(doc, update)
        const expected = ['new', 'alpha', 'BETA', count === 3 ? 'GAMMA' : 'gamma'].join(separator) + '\n'
        for (const doc of docs) expect(await codec.exportFile(doc, context)).toEqual(utf8(expected))
        for (const doc of docs) doc.destroy()
        base.destroy()
      })
    }

    it(`keeps quoted fields and blank records independent of new-cell quoting (${label})`, async () => {
      const base = new Y.Doc()
      base.clientID = 100
      const context = { name: 'quoted.csv', assets }
      await codec.importFile(base, utf8('"a"\n\n"b"\n\n'), context)
      const docs = clientIds.map((clientID) => {
        const doc = new Y.Doc()
        doc.clientID = clientID
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
        return doc
      })
      new WorkbookModel(docs[0]!).sheets()[0]!.setCell(0, 0, { v: 'A' })
      new WorkbookModel(docs[1]!).sheets()[0]!.setCell(2, 0, { v: 'B' })
      if (count === 3) new WorkbookModel(docs[2]!).sheets()[0]!.setCell(4, 0, { v: 'C' })
      const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc))
      if (reverse) updates.reverse()
      for (const doc of docs) for (const update of updates) Y.applyUpdate(doc, update)
      const expected = '"A"\n\n"B"\n\n' + (count === 3 ? '"C"\n' : '')
      for (const doc of docs) expect(await codec.exportFile(doc, context)).toEqual(utf8(expected))
      for (const doc of docs) doc.destroy()
      base.destroy()
    })
  }
})
