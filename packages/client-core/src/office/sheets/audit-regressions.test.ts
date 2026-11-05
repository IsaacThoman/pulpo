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
import { MAX_EXPANDED_CELLS } from './limits.js'
import { columnIntervalProps } from './model/column-intervals.js'
import type { DrawingObject } from './model/schema.js'
import { WorkbookModel, type SheetModel } from './model/workbook.js'
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
    colLayout: { size: () => 64, isHidden: () => false },
    rowLayout: { size: () => 20, isHidden: () => false },
    display: { render: () => ({ text: 'x', color, hAlign: 'left', borders: {}, style: { fontName: font, fontSize: 11 } }) },
  } as unknown as SheetView)
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
})
