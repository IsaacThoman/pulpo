import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { LiveFormatError } from '../../live-format.js'
import { MemoryLiveAssetStore } from '../../assets.js'
import { toA1Form, toIdForm } from '../model/formula-ids.js'
import { deleteAxis, insertAxis } from '../model/structure.js'
import type { ConditionalFormat, DataValidation, Hyperlink, Note } from '../model/schema.js'
import { WorkbookModel } from '../model/workbook.js'
import { SheetCodec } from './codec.js'

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

interface SheetSpec {
  name: string
  xml: string
  rels?: string
  state?: string
}

/** Builds an xlsx package by hand, so tests control every byte of every part. */
function buildXlsx(options: {
  sheets: SheetSpec[]
  sharedStrings?: string[]
  styles?: string
  definedNames?: string
  extraParts?: Record<string, Uint8Array | string>
  extraOverrides?: string
  extraWorkbookRels?: string
  macro?: boolean
}): Uint8Array {
  const sheetOverrides = options.sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  const mainType = options.macro ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/xl/workbook.xml" ContentType="${mainType}"/>${sheetOverrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${options.extraOverrides ?? ''}</Types>`,
    ),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${R}"><workbookPr/><bookViews><workbookView/></bookViews><sheets>${options.sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ''} r:id="rId${index + 1}"/>`).join('')}</sheets>${options.definedNames ? `<definedNames>${options.definedNames}</definedNames>` : ''}<calcPr calcId="191029"/></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${options.sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${R}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId90" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId91" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>${options.extraWorkbookRels ?? ''}</Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      options.styles ??
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><font><b/><color rgb="FFFF0000"/></font></dxf></dxfs></styleSheet>`,
    ),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${MAIN}" count="${options.sharedStrings?.length ?? 0}" uniqueCount="${options.sharedStrings?.length ?? 0}">${(options.sharedStrings ?? []).map((item) => `<si>${item}</si>`).join('')}</sst>`),
  }
  options.sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.xml)
    if (sheet.rels) files[`xl/worksheets/_rels/sheet${index + 1}.xml.rels`] = strToU8(sheet.rels)
  })
  for (const [path, data] of Object.entries(options.extraParts ?? {})) files[path] = typeof data === 'string' ? strToU8(data) : data
  return zipSync(files)
}

function worksheet(body: string, before = '', after = ''): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}" xmlns:r="${R}" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac">${before}<sheetData>${body}</sheetData>${after}</worksheet>`
}

async function open(bytes: Uint8Array, name = 'Book.xlsx'): Promise<{ doc: Y.Doc; model: WorkbookModel; codec: SheetCodec; assets: MemoryLiveAssetStore }> {
  const codec = new SheetCodec()
  const assets = new MemoryLiveAssetStore()
  const doc = new Y.Doc()
  await codec.importFile(doc, bytes, { name, assets })
  return { doc, model: new WorkbookModel(doc), codec, assets }
}

function parts(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([path, data]) => [path, strFromU8(data)]))
}

function formulaAt(model: WorkbookModel, sheet: number, row: number, col: number): string | undefined {
  const target = model.sheets()[sheet]!
  const data = target.cell(row, col)
  return data?.f === undefined ? undefined : toA1Form(data.f, target)
}

const RICH = '<r><rPr><b/><sz val="11"/><color rgb="FFFF0000"/><rFont val="Calibri"/></rPr><t>Bold</t></r><r><t xml:space="preserve"> plain</t></r>'

const FULL_SHEET = worksheet(
  '<row r="1" spans="1:4" x14ac:dyDescent="0.25"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c><c r="D1" t="b"><v>1</v></c></row>' +
    '<row r="2"><c r="A2"><v>1.5</v></c><c r="B2" s="2"><f t="shared" ref="B2:B4" si="0">A2*2</f><v>3</v></c><c r="C2" t="e"><v>#N/A</v></c></row>' +
    '<row r="3" ht="30" customHeight="1"><c r="A3"><v>2</v></c><c r="B3" s="2"><f t="shared" si="0"/><v>4</v></c></row>' +
    '<row r="4" hidden="1"><c r="A4"><v>3</v></c><c r="B4" s="2"><f t="shared" si="0"/><v>6</v></c></row>' +
    '<row r="6"><c r="A6"><f t="array" ref="A6:A7">A2:A3*10</f><v>15</v></c></row><row r="7"><c r="A7"><v>20</v></c></row>' +
    '<row r="8"><c r="A8" t="str"><f>"a"&amp;"b"</f><v>ab</v></c><c r="B8"><f>SUM(Other!A1:A3)+Rate</f><v>9</v></c><c r="C8"><f>_xlfn.FUTUREFUNC(1)</f><v>42</v></c></row>',
  '<sheetPr><tabColor rgb="FF00B050"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:D8"/><sheetViews><sheetView tabSelected="1" workbookViewId="0" zoomScale="120"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="B3" sqref="B3"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/><cols><col min="1" max="1" width="20" customWidth="1"/><col min="3" max="3" width="5" hidden="1" customWidth="1"/></cols>',
  '<sheetProtection sheet="1" objects="1" scenarios="1"/><mergeCells count="1"><mergeCell ref="C4:D5"/></mergeCells>' +
    '<conditionalFormatting sqref="A2:A4"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>1</formula></cfRule></conditionalFormatting>' +
    '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="D2:D4"><formula1>"x,y,z"</formula1></dataValidation></dataValidations>' +
    '<hyperlinks><hyperlink ref="A1" r:id="rId1" tooltip="Go"/><hyperlink ref="B1" location="Other!A1" display="Other"/></hyperlinks>' +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="landscape"/><customElement xmlns="urn:example">keep me</customElement>' +
    '<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings/></ext></extLst>',
)

function fullWorkbook(extra: Partial<Parameters<typeof buildXlsx>[0]> = {}): Uint8Array {
  return buildXlsx({
    sheets: [
      { name: 'Data', xml: FULL_SHEET, rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/></Relationships>` },
      { name: 'Other', xml: worksheet('<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c></row><row r="3"><c r="A3"><v>3</v></c></row>') },
      { name: 'Secret', xml: worksheet(''), state: 'hidden' },
    ],
    sharedStrings: [RICH, '<t>Header</t><rPh sb="0" eb="1"><t>ph</t></rPh><phoneticPr fontId="0"/>'],
    definedNames: '<definedName name="Rate">Other!$A$2</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">Data!$A$1:$D$8</definedName>',
    extraParts: {
      'customXml/item1.xml': '<root xmlns="urn:custom">data</root>',
      'docProps/custom.bin': new Uint8Array([0, 1, 2, 3, 255]),
    },
    extraOverrides: '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>',
    ...extra,
  })
}

describe('xlsx import', () => {
  it('reads values, rich text, styles, formulas, and structure', async () => {
    const { model } = await open(fullWorkbook())
    const [data, other, secret] = model.sheets()
    expect(model.sheets().map((sheet) => sheet.name)).toEqual(['Data', 'Other', 'Secret'])
    expect(secret!.state).toBe('hidden')
    expect(data!.tabColor).toEqual({ rgb: 'FF00B050' })
    expect(data!.cell(0, 0)).toMatchObject({ v: 'Bold plain', runs: [{ text: 'Bold', font: { bold: true } }, { text: ' plain' }] })
    expect(data!.cell(0, 1)).toMatchObject({ v: 'Header' })
    expect(data!.cell(0, 1)!.phonetic).toContain('rPh')
    expect(data!.cell(0, 2)!.v).toBe('inline')
    expect(data!.cell(0, 3)!.v).toBe(true)
    expect(data!.cell(1, 2)).toEqual({ v: '#N/A', t: 'e' })
    // Shared formulas are expanded with their references moved.
    expect(formulaAt(model, 0, 1, 1)).toBe('A2*2')
    expect(formulaAt(model, 0, 2, 1)).toBe('A3*2')
    expect(formulaAt(model, 0, 3, 1)).toBe('A4*2')
    expect(data!.cell(3, 1)!.v).toBe(6)
    // A legacy array formula keeps its cached results on the anchor, not as content.
    expect(data!.cell(5, 0)).toMatchObject({ array: { rows: 2, cols: 1 }, spillCache: [[15], [20]] })
    expect(data!.cell(6, 0)).toBeUndefined()
    expect(formulaAt(model, 0, 7, 1)).toBe('SUM(Other!A1:A3)+Rate')
    expect(formulaAt(model, 0, 7, 2)).toBe('_xlfn.FUTUREFUNC(1)')
    expect(data!.cell(7, 2)!.v).toBe(42)
    expect(data!.viewProp('frozenRows')).toBe(1)
    expect(data!.viewProp('zoom')).toBe(120)
    expect(data!.rowProp(2, 'size')).toBe(30)
    expect(data!.rowProp(3, 'hidden')).toBe(true)
    expect(data!.colProp(0, 'size')).toBe(20)
    expect(data!.colProp(2, 'hidden')).toBe(true)
    expect(data!.mergedRanges().map((merge) => merge.range)).toEqual([{ top: 3, left: 2, bottom: 4, right: 3 }])
    const cf = [...data!.cf.values()] as ConditionalFormat[]
    expect(cf[0]!.rules[0]).toMatchObject({ type: 'cellIs', operator: 'greaterThan', dxfId: 0 })
    const dv = [...data!.dv.values()] as DataValidation[]
    expect(dv[0]).toMatchObject({ type: 'list', formula1: '"x,y,z"', allowBlank: true })
    const links = [...data!.links.values()] as Hyperlink[]
    expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ target: 'https://example.com/', tooltip: 'Go' }), expect.objectContaining({ location: 'Other!A1' })]))
    expect([...model.names.values()].map((name) => [name.name, toA1Form(name.formula, name.scope ? model.sheet(name.scope) : undefined, model)])).toEqual([
      ['Rate', 'Other!$A$2'],
      ['_xlnm.Print_Area', 'Data!$A$1:$D$8'],
    ])
    expect(other!.cell(2, 0)!.v).toBe(3)
  })

  it('refuses files it cannot open with a LiveFormatError', async () => {
    const cases: [Uint8Array, string][] = [
      [strToU8('not a zip'), 'corrupt'],
      [new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), 'encrypted'],
      [zipSync({ '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') }), 'corrupt'],
      [buildXlsx({ sheets: [{ name: 'S', xml: worksheet('<row r="1"><c r="A1"><v>1</v></row>') }] }), 'corrupt'],
      [buildXlsx({ sheets: [{ name: 'S', xml: worksheet('<row r="2000000"><c r="A1"><v>1</v></c></row>') }] }), 'corrupt'],
      [buildXlsx({ sheets: [{ name: 'S', xml: '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><worksheet xmlns="' + MAIN + '"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&lol;</t></is></c></row></sheetData></worksheet>' }] }), 'corrupt'],
    ]
    for (const [bytes, code] of cases) {
      await expect(open(bytes)).rejects.toSatisfy((error: unknown) => error instanceof LiveFormatError && error.code === code)
    }
  })

  it('stops at the cell limit', async () => {
    const rows = Array.from({ length: 50 }, (_, row) => `<row r="${row + 1}">${Array.from({ length: 10 }, (_, col) => `<c r="${String.fromCharCode(65 + col)}${row + 1}"><v>1</v></c>`).join('')}</row>`).join('')
    const codec = new SheetCodec({ read: { maxCells: 100 } })
    await expect(codec.importFile(new Y.Doc(), buildXlsx({ sheets: [{ name: 'S', xml: worksheet(rows) }] }), { name: 'a.xlsx', assets: new MemoryLiveAssetStore() })).rejects.toMatchObject({ code: 'too_large' })
  })

  it('never throws anything but LiveFormatError on damaged packages', async () => {
    const good = fullWorkbook()
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let attempt = 0; attempt < 60; attempt++) {
      const bytes = good.slice()
      for (let flip = 0; flip < 1 + Math.floor(random() * 6); flip++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256)
      try {
        const { doc, codec, assets } = await open(bytes)
        await codec.exportFile(doc, { name: 'Book.xlsx', assets })
      } catch (error) {
        expect(error).toBeInstanceOf(LiveFormatError)
      }
    }
  })
})

describe('xlsx export', () => {
  it('writes back what it does not model and keeps untouched parts byte for byte', async () => {
    const input = fullWorkbook()
    const { doc, codec, assets } = await open(input)
    const output = await codec.exportFile(doc, { name: 'Book.xlsx', assets })
    const before = unzipSync(input)
    const after = unzipSync(output)
    expect(after['customXml/item1.xml']).toEqual(before['customXml/item1.xml'])
    expect(after['docProps/custom.bin']).toEqual(before['docProps/custom.bin'])
    const sheet = strFromU8(after['xl/worksheets/sheet1.xml']!)
    expect(sheet).toContain('<customElement xmlns="urn:example">keep me</customElement>')
    expect(sheet).toContain('<sheetProtection sheet="1" objects="1" scenarios="1"/>')
    expect(sheet).toContain('x14:conditionalFormattings')
    expect(sheet).toContain('<pageSetUpPr fitToPage="1"/>')
    expect(sheet).toContain('x14ac:dyDescent="0.25"')
    expect(sheet).toMatch(/<pane[^>]*state="frozen"/)
    // Elements stay in schema order: sheetProtection before mergeCells, hyperlinks before pageMargins.
    const order = ['<sheetData', '<sheetProtection', '<mergeCells', '<conditionalFormatting', '<dataValidations', '<hyperlinks', '<pageMargins', '<pageSetup', '<extLst']
    const positions = order.map((tag) => sheet.indexOf(tag))
    expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]!))).toBe(true)
    const workbook = strFromU8(after['xl/workbook.xml']!)
    expect(workbook).toContain('<definedName name="Rate">Other!$A$2</definedName>')
    expect(workbook).toContain('state="hidden"')
    const strings = strFromU8(after['xl/sharedStrings.xml']!)
    expect(strings).toContain('<b/>')
    expect(strings).toContain('rPh')
    expect(Object.keys(after)).not.toContain('xl/calcChain.xml')
    // And it reads back the same.
    const { model } = await open(output)
    expect(formulaAt(model, 0, 2, 1)).toBe('A3*2')
    expect(model.sheets()[0]!.cell(5, 0)).toMatchObject({ spillCache: [[15], [20]] })
    expect(strFromU8(after['[Content_Types].xml']!)).toContain('/customXml/item1.xml')
  })

  it('keeps vbaProject.bin in .xlsm and drops it when saved as .xlsx', async () => {
    const vba = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 9, 9, 9])
    const input = fullWorkbook({
      macro: true,
      extraParts: { 'xl/vbaProject.bin': vba },
      extraWorkbookRels: '<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>',
    })
    const { doc, codec, assets, model } = await open(input, 'Macro.xlsm')
    expect(model.metaValue('format')).toBe('xlsm')
    const asXlsm = unzipSync(await codec.exportFile(doc, { name: 'Macro.xlsm', assets }))
    expect(asXlsm['xl/vbaProject.bin']).toEqual(vba)
    expect(strFromU8(asXlsm['[Content_Types].xml']!)).toContain('macroEnabled.main+xml')
    const asXlsx = unzipSync(await codec.exportFile(doc, { name: 'Macro.xlsx', assets }))
    expect(asXlsx['xl/vbaProject.bin']).toBeUndefined()
    expect(strFromU8(asXlsx['[Content_Types].xml']!)).toContain('spreadsheetml.sheet.main+xml')
  })

  it('writes edits: values, formulas, styles, structure, notes, sheets', async () => {
    const { doc, codec, assets, model } = await open(fullWorkbook())
    const data = model.sheets()[0]!
    data.setCell(9, 0, { v: 'new text' })
    data.setCell(9, 1, { f: toIdForm('SUM(A2:A4)', data) })
    data.setStyle({ top: 9, left: 0, bottom: 9, right: 0 }, { bold: true, fill: { rgb: 'FFFFFF00' }, numFmt: '0.0%' })
    insertAxis(data, 'row', 0, 1)
    data.notes.set(data.keyAt(2, 2), { author: 'Ann', text: 'A note' } satisfies Note)
    model.renameSheet(model.sheets()[1]!.id, 'Renamed Sheet')
    model.addSheet('Fresh')
    const output = await codec.exportFile(doc, { name: 'Book.xlsx', assets })
    const files = parts(output)
    expect(files['xl/workbook.xml']).toContain("<definedName name=\"Rate\">'Renamed Sheet'!$A$2</definedName>")
    const reread = (await open(output)).model
    const sheet = reread.sheets()[0]!
    expect(sheet.cell(10, 0)!.v).toBe('new text')
    expect(formulaAt(reread, 0, 10, 1)).toBe('SUM(A3:A5)')
    expect(formulaAt(reread, 0, 8, 1)).toBe("SUM('Renamed Sheet'!A1:A3)+Rate")
    expect(sheet.mergedRanges()[0]!.range).toEqual({ top: 4, left: 2, bottom: 5, right: 3 })
    expect([...sheet.notes.values()]).toEqual([expect.objectContaining({ author: 'Ann', text: 'A note' })])
    expect(reread.sheets().map((entry) => entry.name)).toEqual(['Data', 'Renamed Sheet', 'Secret', 'Fresh'])
    expect(files['xl/styles.xml']).toContain('formatCode="0.0%"')
    expect(Object.keys(files).some((path) => /comments\d*\.xml$/.test(path))).toBe(true)
    expect(Object.keys(files).some((path) => path.endsWith('.vml'))).toBe(true)
  })

  it('writes pictures placed in the editor into a new drawing part', async () => {
    const codec = new SheetCodec()
    const assets = new MemoryLiveAssetStore()
    const doc = new Y.Doc()
    await codec.createEmpty(doc, { name: 'Pics.xlsx', assets })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const ref = await assets.put(png, 'image/png')
    const sheet = new WorkbookModel(doc).sheets()[0]!
    sheet.drawings.set('d1', { kind: 'image', anchor: 'oneCell', from: { row: sheet.rows.idAt(2), col: sheet.cols.idAt(1), rowOff: 0, colOff: 0 }, ext: { cx: 952500, cy: 476250 }, xml: '', image: { hash: ref.hash, mimeType: 'image/png' }, name: 'Logo', z: 1 })
    const output = await codec.exportFile(doc, { name: 'Pics.xlsx', assets })
    const files = unzipSync(output)
    expect(files['xl/media/image1.png']).toEqual(png)
    expect(strFromU8(files['xl/worksheets/sheet1.xml']!)).toMatch(/<drawing r:id="rId\d+"\/>/)
    expect(strFromU8(files['xl/drawings/drawing1.xml']!)).toContain('<xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row>')
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('Extension="png"')
    const reread = (await open(output, 'Pics.xlsx')).model.sheets()[0]!
    const drawings = [...reread.drawings.values()] as { kind: string; image?: { hash: string }; name?: string }[]
    expect(drawings).toEqual([expect.objectContaining({ kind: 'image', name: 'Logo', image: expect.objectContaining({ hash: ref.hash }) })])
  })

  it('creates a valid empty workbook', async () => {
    const codec = new SheetCodec()
    const assets = new MemoryLiveAssetStore()
    const doc = new Y.Doc()
    await codec.createEmpty(doc, { name: 'New.xlsx', assets })
    const files = parts(await codec.exportFile(doc, { name: 'New.xlsx', assets }))
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/theme/theme1.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    expect(files['xl/workbook.xml']).toContain('<sheet name="Sheet1" sheetId="1" r:id="rId1"/>')
  })

  it('drops parts nothing refers to any more after a sheet is deleted', async () => {
    const input = buildXlsx({
      sheets: [
        { name: 'A', xml: worksheet('<row r="1"><c r="A1"><v>1</v></c></row>') },
        { name: 'B', xml: worksheet('', '', '<drawing r:id="rId1"/>'), rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>` },
      ],
      extraParts: { 'xl/drawings/drawing1.xml': `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>` },
      extraOverrides: '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>',
    })
    const { doc, codec, assets, model } = await open(input)
    model.deleteSheet(model.sheets()[1]!.id)
    const files = parts(await codec.exportFile(doc, { name: 'Book.xlsx', assets }))
    expect(Object.keys(files)).not.toContain('xl/drawings/drawing1.xml')
    expect(Object.keys(files)).not.toContain('xl/worksheets/sheet2.xml')
    expect(files['[Content_Types].xml']).not.toContain('drawing1.xml')
  })

  it('converts the 1900 date system and keeps 1904 workbooks in theirs', async () => {
    const input = buildXlsx({ sheets: [{ name: 'S', xml: worksheet('<row r="1"><c r="A1"><v>1</v></c></row>') }] })
    const files = unzipSync(input)
    files['xl/workbook.xml'] = strToU8(strFromU8(files['xl/workbook.xml']!).replace('<workbookPr/>', '<workbookPr date1904="1"/>'))
    const { doc, codec, assets, model } = await open(zipSync(files))
    expect(model.date1904).toBe(true)
    expect(parts(await codec.exportFile(doc, { name: 'Book.xlsx', assets }))['xl/workbook.xml']).toContain('date1904="1"')
  })
})

describe('applyFile', () => {
  it('merges a new version made elsewhere with edits made here at the same time', async () => {
    const { doc, codec, assets } = await open(fullWorkbook())
    // Another replica, as a collaborator.
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const peerModel = new WorkbookModel(peer)
    // The agent's version: a row inserted at the top of Other, a value changed in Data.
    const agent = await open(fullWorkbook())
    const agentData = agent.model.sheets()[0]!
    agentData.setCell(1, 0, { v: 100 })
    insertAxis(agent.model.sheets()[1]!, 'row', 0, 1)
    agent.model.sheets()[1]!.setCell(0, 0, { v: 'inserted' })
    const agentBytes = await agent.codec.exportFile(agent.doc, { name: 'Book.xlsx', assets: agent.assets })
    // Meanwhile the peer edits Other!A3 (which the agent's insert moves to A4).
    peerModel.sheets()[1]!.setCell(2, 1, { v: 'peer' })
    const result = await codec.applyFile(doc, agentBytes, { name: 'Book.xlsx', assets }, 'agent')
    expect(result.changed).toBe(true)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)))
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(peer)))
    for (const model of [new WorkbookModel(doc), peerModel]) {
      const other = model.sheets()[1]!
      expect(model.sheets()[0]!.cell(1, 0)!.v).toBe(100)
      expect(other.cell(0, 0)!.v).toBe('inserted')
      expect(other.cell(3, 0)!.v).toBe(3)
      // The peer's cell moved down with its row.
      expect(other.cell(3, 1)!.v).toBe('peer')
      // Formulas pointing at Other kept pointing at the same cells.
      expect(formulaAt(model, 0, 7, 1)).toBe('SUM(Other!A2:A4)+Rate')
    }
  })

  it('reports no change for the same file and keeps ids', async () => {
    const input = fullWorkbook()
    const { doc, codec, assets, model } = await open(input)
    const rowIds = model.sheets()[0]!.rows.resolve().ids.slice()
    const output = await codec.exportFile(doc, { name: 'Book.xlsx', assets })
    expect((await codec.applyFile(doc, output, { name: 'Book.xlsx', assets })).changed).toBe(false)
    expect(model.sheets()[0]!.rows.resolve().ids).toEqual(rowIds)
  })

  it('deletes rows the new version removed, adds sheets, and removes sheets', async () => {
    const { doc, codec, assets, model } = await open(fullWorkbook())
    const agent = await open(fullWorkbook())
    deleteAxis(agent.model.sheets()[1]!, 'row', 0, 1)
    agent.model.deleteSheet(agent.model.sheets()[2]!.id)
    agent.model.addSheet('Summary').setCell(0, 0, { v: 'total' })
    await codec.applyFile(doc, await agent.codec.exportFile(agent.doc, { name: 'Book.xlsx', assets: agent.assets }), { name: 'Book.xlsx', assets })
    expect(model.sheets().map((sheet) => sheet.name)).toEqual(['Data', 'Other', 'Summary'])
    expect([0, 1].map((row) => model.sheets()[1]!.cell(row, 0)?.v)).toEqual([2, 3])
    expect(model.sheets()[2]!.cell(0, 0)!.v).toBe('total')
  })
})

describe('toText', () => {
  it('lists values as displayed and formulas', async () => {
    const { doc, codec } = await open(fullWorkbook())
    const text = codec.toText(doc)
    expect(text).toContain('## Data')
    expect(text).toContain('Bold plain\tHeader\tinline\tTRUE')
    expect(text).toContain('B3: =A3*2')
    expect(text).toContain('## Secret (hidden)')
  })
})
