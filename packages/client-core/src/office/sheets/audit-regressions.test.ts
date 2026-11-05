import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { MAX_COLS, MAX_ROWS } from './address.js'
import { SheetCalc } from './calc.js'
import { applyWorkbook } from './codec/apply.js'
import { SheetCodec } from './codec/codec.js'
import { readCsv, writeCsv } from './codec/csv.js'
import { writeDrawing } from './codec/drawing.js'
import { calculationBudget, CalculationStopped } from './formula/budget.js'
import { wildcardIndex, wildcardMatch } from './formula/functions/criteria.js'
import { markCalcDirty, trackEdits } from './model/edits.js'
import { dateToSerial } from './dates.js'
import { MAX_EXPANDED_CELLS } from './limits.js'
import { columnIntervalProps } from './model/column-intervals.js'
import type { DrawingObject } from './model/schema.js'
import { WorkbookModel, SheetModel } from './model/workbook.js'
import { parseHtml } from './view/clipboard.js'
import { SheetView } from './view/sheet-view.js'

const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser; document: Document } } }

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** Matches the audit's tiny package without depending on an external workbook generator. */
function xlsx(body: string, after = ''): Uint8Array {
  const parts: Record<string, string> = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><sheetData>${body}</sheetData>${after}</worksheet>`,
  }
  return zipSync(Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, strToU8(xml)])))
}

async function open(bytes: Uint8Array, name = 'Book.xlsx') {
  const codec = new SheetCodec()
  const assets = new MemoryLiveAssetStore()
  const context = { name, assets }
  const doc = new Y.Doc()
  await codec.importFile(doc, bytes, context)
  const workbook = new WorkbookModel(doc)
  return { codec, context, doc, workbook, sheet: workbook.sheets()[0]! }
}

function print(sheet: SheetModel, font = 'Calibri', color = '#000') {
  return SheetView.prototype.printHtml.call({
    sheet,
    settleEdit: () => true,
    colLayout: { size: () => 64, isHidden: () => false },
    rowLayout: { size: () => 20, isHidden: () => false },
    display: { render: () => ({ text: 'x', color, hAlign: 'left', borders: {}, style: { fontName: font, fontSize: 11 } }) },
  } as unknown as SheetView)
}

/** Merges both delivery orders into three explicit client ids, keeping the source snapshot fixed. */
function replicas(base: Y.Doc, edit: (sheet: SheetModel, client: number) => void): Y.Doc[] {
  const result: Y.Doc[] = []
  for (const reverse of [false, true]) {
    const docs = [1, 2, 3].map((id) => {
      const doc = new Y.Doc()
      doc.clientID = id
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
      return doc
    })
    for (let index = 0; index < 2; index++) edit(new WorkbookModel(docs[index]!).sheets()[0]!, index + 1)
    const updates = docs.slice(0, 2).map((doc) => Y.encodeStateAsUpdate(doc))
    for (const doc of docs) for (const update of reverse ? [...updates].reverse() : updates) Y.applyUpdate(doc, update)
    result.push(...docs)
  }
  return result
}

describe('spreadsheet audit regressions', () => {
  it.each(['Infinity', 'NaN', '-1', '1.5', String(MAX_ROWS)])('drops drawing anchors with invalid row %s (finding 1)', async (row) => {
    const parts = unzipSync(readFileSync(new URL('../../../test-fixtures/sheets/generated/gen-image.xlsx', import.meta.url)))
    const baseline = await open(zipSync(parts))
    const path = Object.keys(parts).find((path) => /^xl\/drawings\/drawing\d+\.xml$/.test(path))!
    parts[path] = strToU8(strFromU8(parts[path]!).replace(/(<(?:\w+:)?row>)[^<]*(<\/(?:\w+:)?row>)/, `$1${row}$2`))
    const { sheet } = await open(zipSync(parts))
    expect(sheet.drawings.size).toBe(baseline.sheet.drawings.size - 1)
    expect(sheet.rows.length).toBeLessThan(10_000)
  })

  it.each([false, true])('preserves oversized array formulas without expanding them, dynamic=%s (finding 2)', async (dynamic) => {
    const bytes = xlsx(`<row r="1"><c r="A1"${dynamic ? ' cm="1"' : ''}><f t="array" ref="A1:XFD1048576">1</f><v>1</v></c></row>`)
    if (!dynamic) expect(bytes.length).toBe(1360)
    const { workbook, sheet, codec, context, doc } = await open(bytes)
    const calc = new SheetCalc(workbook)
    calc.recalculateAll()
    expect(calc.get(sheet, 0, 0)).toBe(1)
    expect(calc.isUnsupported(sheet, 0, 0)).toBe(true)
    const exported = await codec.exportFile(doc, context)
    const output = unzipSync(exported)
    expect(strFromU8(output['xl/worksheets/sheet1.xml']!)).toContain('t="array" ref="A1:XFD1048576"')
    const again = await open(exported)
    expect(again.sheet.cell(0, 0)).toEqual(sheet.cell(0, 0))
    expect(sheet.cells.size).toBe(1)
    calc.destroy()
  })

  it('bounds HTML clipboard spans and paste area (finding 5)', () => {
    vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser)
    try {
      for (const span of ['Infinity', 'NaN', '-1', '1.5']) {
        expect(parseHtml(`<table><tr><td rowspan="${span}" colspan="${span}">x</td><td>y</td></tr></table>`)?.cells[0]?.map((cell) => cell.text)).toEqual(['x', 'y'])
      }
      const html = `<table><tr><td rowspan="1048576" colspan="16384">x</td></tr>${'<tr><td>y</td></tr>'.repeat(100)}</table>`
      const parsed = parseHtml(html)!
      expect(parsed.cells.length * MAX_COLS).toBeLessThanOrEqual(MAX_EXPANDED_CELLS)
      expect(parsed.cells.flat().filter((cell) => cell.text === 'y')).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('serializes file fonts as CSS strings and rejects declaration-shaped colors (finding 6)', () => {
    const sheet = WorkbookModel.initialize(new Y.Doc()).addSheet('Sheet1')
    sheet.setCell(0, 0, { v: 'x' })
    const font = "x';background-image:url(https://example.invalid/probe);font-family:'y"
    const td = new JSDOM(print(sheet, font, 'red;background-image:url(https://example.invalid/color)')).window.document.querySelector('td')!
    expect(td.style.backgroundImage).toBe('')
    expect(td.style.color).toBe('')
    expect(td.style.fontFamily).toContain('background-image')
    expect(td.style.fontSize).toBe('11pt')
  })

  it('clips huge print merges without enumerating their cells (finding 7)', async () => {
    const { sheet } = await open(xlsx('<row r="1"><c r="A1"><v>1</v></c></row>', '<mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells>'))
    const html = print(sheet)
    expect(html).toContain('rowspan="1" colspan="1"')
    expect(html.match(/<td/g)).toHaveLength(1)
  })

  it.each(['shape', 'image', 'chart'] as const)('applies changes to preserved %s XML (finding 8)', (kind) => {
    const doc = new Y.Doc()
    const sheet = WorkbookModel.initialize(doc).addSheet('Sheet1')
    sheet.drawings.set('object', { kind, anchor: 'absolute', z: 1, xml: '<xdr:sp><a:t>Before</a:t></xdr:sp>' } satisfies DrawingObject)
    const incoming = new Y.Doc()
    Y.applyUpdate(incoming, Y.encodeStateAsUpdate(doc))
    const other = new WorkbookModel(incoming).sheets()[0]!
    other.drawings.set('object', { ...(other.drawings.get('object') as DrawingObject), xml: '<xdr:sp><a:t>After</a:t></xdr:sp>' })
    expect(applyWorkbook(doc, incoming).changed).toBe(true)
    expect((Array.from(sheet.drawings.values())[0] as DrawingObject).xml).toContain('After')
    expect(applyWorkbook(doc, incoming).changed).toBe(false)
  })

  it('ignores drawing XML prefix, attribute-order, and object-id differences (finding 8)', () => {
    const doc = new Y.Doc()
    const sheet = WorkbookModel.initialize(doc).addSheet('Sheet1')
    sheet.drawings.set('shape', { kind: 'shape', anchor: 'absolute', z: 1, xml: '<xdr:sp><xdr:cNvPr id="1" name="Shape"/><a:t>Same</a:t></xdr:sp>' } satisfies DrawingObject)
    const incoming = new Y.Doc()
    Y.applyUpdate(incoming, Y.encodeStateAsUpdate(doc))
    const other = new WorkbookModel(incoming).sheets()[0]!
    other.drawings.set('shape', { ...(other.drawings.get('shape') as DrawingObject), xml: '<sp xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><cNvPr name="Shape" id="42"/><a:t>Same</a:t></sp>' })
    expect(applyWorkbook(doc, incoming).changed).toBe(false)
  })

  it.each(['a,b,\nc,d,\n', 'a\tb\nc\td\n', 'a;b;\r\nc;d;\n', 'a|b\nc|d\n', 'a,b\nc,d\r\n', 'a,b\rc,d\r\nlast,'])('round-trips CSV bytes %j (finding 9)', async (text) => {
    const { doc, codec, context } = await open(strToU8(text), 'Book.csv')
    expect(strFromU8(await codec.exportFile(doc, context))).toBe(text)
  })

  it('keeps multiple wide column intervals and their bounds (finding 10)', async () => {
    const parts = unzipSync(xlsx(''))
    parts['xl/worksheets/sheet1.xml'] = strToU8(`<worksheet xmlns="${NS}"><cols><col min="1" max="2048" width="20" customWidth="1"/><col min="2049" max="16384" width="10" customWidth="1"/></cols><sheetData/></worksheet>`)
    const { sheet, codec, doc, context } = await open(zipSync(parts))
    expect(columnIntervalProps(sheet, 0).size).toBe(20)
    expect(columnIntervalProps(sheet, 2048).size).toBe(10)
    const output = unzipSync(await codec.exportFile(doc, context))
    const xml = strFromU8(output['xl/worksheets/sheet1.xml']!)
    expect(xml).toContain('min="1" max="2048" width="20"')
    expect(xml).toContain('min="2049" max="16384" width="10"')
    sheet.raw.set('colTail', { from: 10, to: 20, props: { size: 30 } })
    expect(columnIntervalProps(sheet, 9)).toEqual({})
    expect(columnIntervalProps(sheet, 20).size).toBe(30)
    expect(columnIntervalProps(sheet, 21)).toEqual({})
  })

  it('applies 140,000 row metadata entries without spreading arguments (finding 11)', () => {
    const doc = new Y.Doc()
    const sheet = WorkbookModel.initialize(doc).addSheet('Sheet1')
    doc.transact(() => {
      sheet.rows.ensure(140_000)
      for (let row = 0; row < 140_000; row++) sheet.rowMeta.set(`${sheet.rows.idAt(row)}|size`, 20)
    })
    const incoming = new Y.Doc()
    Y.applyUpdate(incoming, Y.encodeStateAsUpdate(doc))
    expect(applyWorkbook(doc, incoming)).toEqual({ changed: false })
  }, 10_000)

  it('counts omitted whole-column and whole-row blanks with logical dimensions (finding 12)', () => {
    const workbook = WorkbookModel.initialize(new Y.Doc())
    const sheet = workbook.addSheet('Sheet1')
    sheet.setCell(0, 0, { v: 1 })
    const calc = new SheetCalc(workbook)
    for (const [formula, expected] of [
      ['COUNTBLANK(A:A)', MAX_ROWS - 1], ['COUNTIF(A:A,"")', MAX_ROWS - 1], ['COUNTIF(A:A,"=")', MAX_ROWS - 1],
      ['COUNTIFS(A:A,"",B:B,"=")', MAX_ROWS - 1], ['ROWS(A:A)', MAX_ROWS], ['COLUMNS(1:1)', MAX_COLS],
      ['COUNTBLANK(1:1)', MAX_COLS - 1], ['COUNTA(A:A)', 1], ['COUNT(A:A)', 1], ['SUMPRODUCT(A:A)', 1],
      ['SUMPRODUCT(--(A:A=""))', MAX_ROWS - 1], ['MATCH("",A:A&"",0)', 2], ['COUNTBLANK(A1:A1048575)', MAX_ROWS - 2],
    ] as const) expect(calc.evaluate(sheet, 0, 1, formula), formula).toBe(expected)
    expect(calc.evaluate(sheet, 0, 1, 'MATCH(0,A:A,0)')).toEqual(calc.evaluate(sheet, 0, 1, 'MATCH(0,A1:A100,0)'))
    calc.destroy()
  })
  it.each([
    ['hello', 'HeLLo', true], ['hello', 'hell', false], ['', '', true], ['', 'x', false],
    ['*', '', true], ['?', '', false], ['?', 'A', true], ['?', 'AB', false],
    ['a*b', 'ab', true], ['a*b', 'aXYZb', true], ['*ab', 'XAB', true], ['ab*', 'ABX', true],
    ['a?c', 'AbC', true], ['a?c', 'ac', false], ['~*', '*', true], ['~?', '?', true],
    ['~~', '~', true], ['~a', '~A', true], ['~', '~', true], ['*~**', 'a*b', true],
    ['a.b', 'axb', false], ['*?*', '\n', true],
  ] as const)('matches bounded Excel wildcards %j against %j', (pattern, text, expected) => {
    expect(wildcardMatch(pattern, text)).toBe(expected)
  })

  it.each([
    ['a?c', 'xxAbCyy', 2], ['*ab', 'xxab', 0], ['ab*', 'xxab', 2],
    ['a*b', 'xxaccb', 2], ['~*', 'x*y', 1], ['', 'abc', 0], ['?', '', -1],
    ['ab', 'aaab', 2], ['a*b?c', 'xa123bxc', 1],
  ] as const)('finds wildcard substrings %j in %j', (pattern, text, expected) => {
    expect(wildcardIndex(pattern, text)).toBe(expected)
  })

  it('finishes the exponential wildcard reproduction in milliseconds and charges every caller', () => {
    const pattern = '*a'.repeat(14) + 'b'
    const text = 'a'.repeat(28) + 'c'
    const start = performance.now()
    expect(wildcardMatch(pattern, text)).toBe(false)
    expect(wildcardIndex(pattern, text)).toBe(-1)
    expect(performance.now() - start).toBeLessThan(100)
    const restore = calculationBudget(100)
    try {
      expect(() => wildcardMatch(pattern, text)).toThrow(CalculationStopped)
      expect(() => wildcardIndex(pattern, text)).toThrow(CalculationStopped)
    } finally { restore() }
    const workbook = WorkbookModel.initialize(new Y.Doc())
    const sheet = workbook.addSheet('Sheet1')
    sheet.setCell(0, 0, { v: 'Header' })
    sheet.setCell(1, 0, { v: 'a*b' })
    sheet.setCell(2, 0, { v: 'other' })
    sheet.setCell(1, 1, { v: 7 })
    sheet.setCell(2, 1, { v: 3 })
    sheet.setCell(0, 3, { v: 'Header' })
    sheet.setCell(1, 3, { v: '=a~*b' })
    const calc = new SheetCalc(workbook)
    for (const [formula, expected] of [
      ['COUNTIF(A2:A3,"a~*b")', 1], ['COUNTIFS(A2:A3,"a~*b")', 1],
      ['SUMIF(A2:A3,"a~*b",B2:B3)', 7], ['SUMIFS(B2:B3,A2:A3,"a~*b")', 7],
      ['AVERAGEIF(A2:A3,"a~*b",B2:B3)', 7], ['AVERAGEIFS(B2:B3,A2:A3,"a~*b")', 7],
      ['MAXIFS(B2:B3,A2:A3,"a~*b")', 7], ['MINIFS(B2:B3,A2:A3,"a~*b")', 7],
      ['MATCH("a~*b",A2:A3,0)', 1], ['XLOOKUP("a~*b",A2:A3,B2:B3,,2)', 7],
      ['VLOOKUP("a~*b",A2:B3,2,FALSE)', 7], ['HLOOKUP("a~*b",A2:B3,1,FALSE)', 'a*b'],
      ['SEARCH("~*",A2)', 2], ['DCOUNTA(A1:A3,"Header",D1:D2)', 1],
    ] as const) expect(calc.evaluate(sheet, 0, 5, formula), formula).toBe(expected)
    calc.destroy()
    sheet.setCell(1, 0, { v: text })
    const bounded = new SheetCalc(workbook, { maxWork: 100, live: false })
    const before = performance.now()
    bounded.evaluate(sheet, 0, 5, `COUNTIF(A2,"${pattern}")`)
    expect(performance.now() - before).toBeLessThan(100)
    bounded.destroy()
  })

  it.each([false, true])('exports colliding tables across three replicas and both orders, defined names=%s', async (definedNames) => {
    const base = new Y.Doc()
    base.clientID = 100
    const workbook = WorkbookModel.initialize(base)
    const sheet = workbook.addSheet('Sheet1')
    const add = (sheet: SheetModel, id: string, name: string, row: number) => {
      sheet.tables.set(id, { name, displayName: name, range: sheet.rangeIds({ top: row, left: 0, bottom: row + 1, right: 0 }), headerRow: true, totalsRow: false, columns: [{ name: 'Header' }] })
    }
    add(sheet, 'existing', 'Foo_3', 0)
    if (definedNames) {
      workbook.names.set('reserved2', { name: 'fOO_2', formula: '1' })
      workbook.names.set('reserved4', { name: 'FOO_4', formula: '1' })
    }
    const docs = replicas(base, (sheet, client) => add(sheet, `new${client}`, 'Foo', client * 2))
    const codec = new SheetCodec()
    const context = { name: 'Tables.xlsx', assets: new MemoryLiveAssetStore() }
    const exports = await Promise.all(docs.map((doc) => codec.exportFile(doc, context)))
    for (const bytes of exports) expect(Buffer.from(bytes).equals(Buffer.from(exports[0]!))).toBe(true)
    const parts = unzipSync(exports[0]!)
    const names = Object.entries(parts).filter(([path]) => /^xl\/tables\/table.*xml$/.test(path)).map(([, bytes]) => / name="([^"]+)"/.exec(strFromU8(bytes))![1])
    expect(names).toEqual(['Foo_3', 'Foo', definedNames ? 'Foo_5' : 'Foo_2'])
    for (const doc of docs) doc.destroy()
    base.destroy()
  })

  it('exports ragged CSV with stored-cell work instead of rectangular lookups', () => {
    const text = Array(100).fill('x').join(',') + '\n' + 'x\n'.repeat(9)
    const doc = new Y.Doc()
    readCsv(doc, strToU8(text), 'csv')
    const cell = vi.spyOn(SheetModel.prototype, 'cell')
    try {
      expect(strFromU8(writeCsv(doc, 'csv'))).toBe(text)
      expect(cell.mock.calls.length).toBeLessThanOrEqual(109)
    } finally { cell.mockRestore() }
    doc.destroy()
  })

  it('exports a 16,384-column row and 50,000 one-field rows within a few seconds', () => {
    const text = Array(MAX_COLS).fill('x').join(',') + '\n' + 'x\n'.repeat(50_000)
    const doc = new Y.Doc()
    readCsv(doc, strToU8(text), 'csv')
    const start = performance.now()
    const bytes = writeCsv(doc, 'csv')
    const elapsed = performance.now() - start
    expect(strFromU8(bytes)).toBe(text)
    expect(elapsed).toBeLessThan(3000)
    doc.destroy()
  }, 15_000)

  it('assigns stable picture ids after preserved objects in canonical order', async () => {
    const base = new Y.Doc()
    base.clientID = 100
    const workbook = WorkbookModel.initialize(base)
    const sheet = workbook.addSheet('Sheet1')
    const assets = new MemoryLiveAssetStore()
    const image = await assets.put(new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=', 'base64')), 'image/png')
    sheet.drawings.set('preserved', { kind: 'shape', anchor: 'absolute', xml: '<xdr:sp><xdr:cNvPr name="Old" id="42"/></xdr:sp>', z: 0 } satisfies DrawingObject)
    const docs = replicas(base, (sheet, client) => {
      sheet.drawings.set(`pic${client}`, { kind: 'image', anchor: 'oneCell', from: { row: sheet.rows.idAt(client), col: sheet.cols.idAt(0), rowOff: 0, colOff: 0 }, ext: { cx: 100, cy: 100 }, z: 1, xml: '', image: { hash: image.hash, mimeType: 'image/png' } } satisfies DrawingObject)
    })
    const codec = new SheetCodec()
    const context = { name: 'Pictures.xlsx', assets }
    const exports = await Promise.all(docs.flatMap((doc) => [codec.exportFile(doc, context), codec.exportFile(doc, context)]))
    for (const bytes of exports) expect(Buffer.from(bytes).equals(Buffer.from(exports[0]!))).toBe(true)
    const xml = strFromU8(unzipSync(exports[0]!)['xl/drawings/drawing1.xml']!)
    const ids = [...xml.matchAll(/cNvPr[^>]* id="(\d+)"/g)].map((match) => Number(match[1]))
    expect(ids).toEqual([42, 43, 44])
    expect(new Set(ids).size).toBe(ids.length)
    const other = new WorkbookModel(docs[0]!).sheets()[0]!
    const withSkeleton = writeDrawing(other, '<xdr:wsDr><xdr:cNvPr id="99"/></xdr:wsDr>', () => 'rId1')
    expect(withSkeleton).toContain('id="100"')
    expect(withSkeleton).toContain('id="101"')
    for (const doc of docs) doc.destroy()
    base.destroy()
  })

  it.each([undefined, 300, -60])('exports fixed-clock formulas identically across host timezones with stored offset %s', async (offset) => {
    const doc = new Y.Doc()
    const workbook = WorkbookModel.initialize(doc)
    const sheet = workbook.addSheet('Sheet1')
    expect(workbook.metaValue('calcTimezoneOffset')).toBeUndefined()
    workbook.setMeta('calcTime', Date.UTC(2024, 0, 1, 1))
    workbook.setMeta('calcDirty', true)
    if (offset !== undefined) workbook.setMeta('calcTimezoneOffset', offset)
    sheet.setCell(0, 0, { f: 'NOW()' })
    sheet.setCell(0, 1, { f: 'TODAY()' })
    sheet.setCell(0, 2, { f: 'DATEVALUE("1/2")' })
    const script = `
      import * as Y from 'yjs';
      import { SheetCodec } from './src/office/sheets/codec/codec.ts';
      import { MemoryLiveAssetStore } from './src/office/assets.ts';
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Buffer.from(process.env.SHEET_SNAPSHOT, 'base64'));
      const bytes = await new SheetCodec().exportFile(doc, { name: 'Clock.xlsx', assets: new MemoryLiveAssetStore() });
      process.stdout.write(Buffer.from(bytes).toString('base64'));
    `
    const outputs = ['UTC', 'America/New_York'].map((TZ) => {
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: new URL('../../../', import.meta.url),
        env: { ...process.env, TZ, SHEET_SNAPSHOT: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }, encoding: 'utf8', timeout: 15_000,
      })
      expect(child.status, child.stderr).toBe(0)
      return Buffer.from(child.stdout, 'base64')
    })
    expect(outputs[0]!.equals(outputs[1]!)).toBe(true)
    const xml = strFromU8(unzipSync(outputs[0]!)['xl/worksheets/sheet1.xml']!)
    const values = [...xml.matchAll(/<v>([^<]+)<\/v>/g)].map((match) => Number(match[1]))
    const now = 45292 + (60 - (offset ?? 0)) / 1440
    expect(values[0]).toBeCloseTo(now, 8)
    expect(values[1]).toBe(Math.floor(now))
    expect(values[2]).toBe(dateToSerial(offset === 300 ? 2023 : 2024, 1, 2))
    doc.destroy()
  }, 30_000)

  it('records the editing timezone with each new calculation clock and ignores snapshot-only edits', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2024, 0, 1))
    const doc = new Y.Doc()
    const workbook = WorkbookModel.initialize(doc)
    const sheet = workbook.addSheet('Sheet1')
    // A recently imported clock still needs the editing client's offset on the first local edit.
    workbook.setMeta('calcTime', Date.now())
    const stop = trackEdits(doc)
    try {
      sheet.setCell(0, 0, { v: 1 })
      expect(workbook.metaValue('calcTime')).toBe(Date.now())
      expect(workbook.metaValue('calcTimezoneOffset')).toBe(new Date(Date.now()).getTimezoneOffset())
      vi.setSystemTime(Date.now() + 60_001)
      workbook.setMeta('calcTimezoneOffset', 123)
      expect(workbook.metaValue('calcTime')).not.toBe(Date.now())
      markCalcDirty(doc)
      expect(workbook.metaValue('calcTime')).toBe(Date.now())
      expect(workbook.metaValue('calcTimezoneOffset')).toBe(new Date(Date.now()).getTimezoneOffset())
      const calc = new SheetCalc(workbook)
      const engine = (calc as unknown as { engine: unknown }).engine
      workbook.setMeta('calcTimezoneOffset', 456)
      expect((calc as unknown as { engine: unknown }).engine).toBe(engine)
      calc.destroy()
    } finally {
      stop()
      doc.destroy()
      vi.useRealTimers()
    }
  })

  it.each([false, true])('uses the snapshot year for date functions and arithmetic across New Year, date1904=%s', async (date1904) => {
    const { codec, context, doc, workbook, sheet } = await open(xlsx(''))
    workbook.setMeta('date1904', date1904)
    workbook.setMeta('calcDirty', true)
    workbook.setMeta('calcTime', Date.UTC(2024, 0, 1, 1))
    workbook.setMeta('calcTimezoneOffset', 300)
    const formulas = ['DATEVALUE("1/2")', 'VALUE("1/2")', 'TIMEVALUE("1/2 12:00")', '"1/2"+0', '-"1/2"', '"1/2"%', 'TEXT("1/2","yyyy-mm-dd")', 'SUM("1/2")', 'DATEVALUE("Jan 2")']
    formulas.forEach((f, col) => sheet.setCell(0, col, { f }))
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.UTC(2024, 11, 31))
      const before = await codec.exportFile(doc, context)
      const text = codec.toText(doc)
      vi.setSystemTime(Date.UTC(2025, 0, 1, 12))
      expect(Buffer.from(await codec.exportFile(doc, context)).equals(Buffer.from(before))).toBe(true)
      expect(codec.toText(doc)).toBe(text)
      const reopened = await open(before)
      const day = dateToSerial(2023, 1, 2, date1904)
      const expected = [day, day, 0.5, day, -day, day / 100, '2023-01-02', day, day]
      expected.forEach((value, col) => expect(reopened.sheet.cell(0, col)?.v, formulas[col]).toEqual(value))
      const live = new SheetCalc(workbook)
      expect(live.evaluate(sheet, 1, 0, 'DATEVALUE("1/2")')).toBe(dateToSerial(2025, 1, 2, date1904))
      live.destroy()
      reopened.doc.destroy()
    } finally {
      vi.useRealTimers()
      doc.destroy()
    }
  })

})
