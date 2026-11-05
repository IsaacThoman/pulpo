import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
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
