import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { OoxmlPackage } from '../ooxml/package.js'
import { diffDocxFiles, diffDocxModels, type DocxDiff, type FormatChange } from './diff.js'
import { exportDocx } from './export.js'
import { importDocx } from './import.js'
import { packJml, type JmlElement } from './jsonml.js'
import { MemoryAssetStore } from './memory-assets.js'
import { emptyMaps, type DocxModel } from './model.js'
import { docxSchema } from './schema.js'

const schema = docxSchema()
const p = (attrs: Record<string, unknown> = {}, content = [schema.text('Unchanged text')]) => schema.node('paragraph', attrs, content)
const table = (attrs = {}, rowAttrs = {}, cellAttrs = {}, paragraphAttrs = {}) => schema.node('table', attrs, [schema.node('tableRow', rowAttrs, [schema.node('tableCell', cellAttrs, [p(paragraphAttrs)])])])
const model = (...blocks: ProseMirrorNode[]): DocxModel => ({ body: schema.node('doc', null, blocks), maps: emptyMaps(), stories: new Map() })
const notes = (diff: DocxDiff): FormatChange[] => [...(diff.formats ?? []), ...diff.blocks.flatMap((block) => block.kind === 'modify' ? block.formats : []), ...diff.stories.flatMap((story) => story.formats ?? [])]

const changes: [string, ProseMirrorNode, string][] = [
  ['table width', table({ tblPr: packJml(['w:tblPr', {}, ['w:tblW', { 'w:w': '8000', 'w:type': 'dxa' }]]) }), 'tblW'],
  ['column widths', table({ tblGrid: packJml(['w:tblGrid', {}, ['w:gridCol', { 'w:w': '8000' }]]) }), 'tblGrid'],
  ['row height', table({}, { trPr: packJml(['w:trPr', {}, ['w:trHeight', { 'w:val': '500' }]]) }), 'trHeight'],
  ['cell width', table({}, {}, { tcPr: packJml(['w:tcPr', {}, ['w:tcW', { 'w:w': '4000', 'w:type': 'dxa' }]]) }), 'tcW'],
  ['cell shading', table({}, {}, { tcPr: packJml(['w:tcPr', {}, ['w:shd', { 'w:fill': 'FF0000' }]]) }), 'shd'],
  ['cell borders', table({}, {}, { tcPr: packJml(['w:tcPr', {}, ['w:tcBorders', {}, ['w:top', { 'w:val': 'single', 'w:sz': '8' }]]]) }), 'tcBorders'],
  ['cell paragraph alignment', table({}, {}, {}, { jc: packJml(['w:jc', { 'w:val': 'center' }]) }), 'jc'],
]

describe('structural Word review', () => {
  it.each(changes)('describes %s changes without text changes', (_name, changed, property) => {
    const diff = diffDocxModels(model(table()), model(changed))
    expect(diff.identical).toBe(false)
    expect(notes(diff)).toEqual(expect.arrayContaining([expect.objectContaining({ property })]))
  })

  it.each(['header', 'footer', 'footnote', 'endnote'])('describes direct formatting, pictures, and table properties in a %s', (kind) => {
    const before = model(p())
    const id = `${kind}:1`
    const story = (doc: ProseMirrorNode) => ({ meta: { kind: kind as 'header' }, doc })
    before.stories.set(id, story(schema.node('doc', null, [p()])))
    for (const [changed, property] of [
      [p({}, [schema.text('Unchanged text', [schema.mark('b', { v: packJml(['w:b', {}]) })])]), 'b'],
      [p({}, [schema.node('drawing', { src: 'new-image-hash', v: packJml(['w:drawing', {}]) })]), 'picture'],
      [changes[4]![1], 'shd'],
    ] as const) {
      const original = property === 'picture' ? p({}, [schema.node('drawing', { src: 'old-image-hash', v: packJml(['w:drawing', {}]) })]) : property === 'shd' ? table() : p()
      before.stories.set(id, story(schema.node('doc', null, [original])))
      const after = { ...before, stories: new Map([[id, story(schema.node('doc', null, [changed]))]]) }
      const diff = diffDocxModels(before, after)
      expect(diff.identical).toBe(false)
      expect(diff.stories).toHaveLength(1)
      expect(notes(diff)).toEqual(expect.arrayContaining([expect.objectContaining({ property })]))
    }
  })

  it('reports opaque changes even alongside a recognized formatting change', () => {
    const before = model(p())
    const after = model(p({ pPrRest: packJml([['w:futureProperty', { 'w:val': 'new' }]]) }, [schema.text('Unchanged text', [schema.mark('b', { v: packJml(['w:b', {}]) })])]))
    const diff = diffDocxModels(before, after)
    expect(notes(diff).map((note) => note.property)).toEqual(expect.arrayContaining(['b', 'formatting']))
  })

  it.each(['paragraph', 'table', 'row', 'cell', 'wrapper', 'inline', 'section'])('catches preserved XML and layout on a %s', (kind) => {
    const unknown = packJml([['w:futureProperty', { 'w:val': 'new' }]])
    let before = p()
    let after = p({ pPrRest: unknown })
    if (kind === 'table') { before = table(); after = table({ rowTrail: unknown }) }
    if (kind === 'row') { before = table(); after = table({}, { cellTrail: unknown }) }
    if (kind === 'cell') { before = table(); after = table({}, {}, { lead: unknown }) }
    if (kind === 'wrapper') { before = schema.node('blockWrapper', { v: packJml(['w:sdt', {}, '\u0000']) }, [p()]); after = schema.node('blockWrapper', { v: packJml(['w:sdt', { 'w:tag': 'changed' }, '\u0000']) }, [p()]) }
    if (kind === 'inline') after = p({}, [schema.text('Unchanged text'), schema.node('inlineXml', { v: packJml(['w:futureProperty', { 'w:val': 'new' }]) })])
    if (kind === 'section') after = p({ sectPr: packJml(['w:sectPr', {}, ['w:pgSz', { 'w:w': '16000' }]]) })
    const diff = diffDocxModels(model(before), model(after))
    expect(diff.identical).toBe(false)
    expect(notes(diff).some((note) => note.property === 'formatting' || note.property === 'layout')).toBe(true)
  })

  it('does not count rsids or attribute ordering as content changes', () => {
    const first: JmlElement = ['w:ind', { 'w:left': '300', 'w:right': '200' }]
    const second: JmlElement = ['w:ind', { 'w:right': '200', 'w:left': '300' }]
    const before = model(p({ ind: packJml(first), xmlAttrs: JSON.stringify({ 'w:rsidR': '000001' }) }))
    const after = model(p({ ind: packJml(second), xmlAttrs: JSON.stringify({ 'w:rsidR': '000002' }) }))
    expect(diffDocxModels(before, after).identical).toBe(true)
  })

  it('does not canonicalize JSON-looking document text or opaque XML text', () => {
    expect(diffDocxModels(model(p({}, [schema.text('{"a":1}')])), model(p({}, [schema.text('{ "a": 1 }')]))).identical).toBe(false)
    const atom = (text: string) => schema.node('inlineXml', { v: packJml(['w:future', {}, text]) })
    expect(diffDocxModels(model(p({}, [atom('{"a":1}')])), model(p({}, [atom('{ "a": 1 }')]))).identical).toBe(false)
  })

  it('keeps fallback notes when table properties and opaque container XML both change', () => {
    const before = model(table())
    const after = model(table({ tblPr: packJml(['w:tblPr', { 'w:future': 'new' }, ['w:tblW', { 'w:w': '1000' }]]) }))
    expect(notes(diffDocxModels(before, after)).map((note) => note.property)).toEqual(expect.arrayContaining(['tblW', 'layout']))
  })

  it('does not let a picture replacement hide opaque link markup on the same atom', () => {
    const picture = (src: string, tag: string) => schema.node('drawing', { src, v: packJml(['w:drawing', {}]),
      marks: JSON.stringify([{ type: 'link', attrs: { href: 'https://example.test', v: packJml(['w:hyperlink', { 'w:tooltip': tag }, '\u0000']) } }]) })
    const diff = diffDocxModels(model(p({}, [picture('old', 'Before')])), model(p({}, [picture('new', 'After')])))
    expect(notes(diff).map((note) => note.property)).toEqual(expect.arrayContaining(['picture', 'formatting']))
  })

  it.each(['sectPr', 'documentExtra', 'bodyTrail', 'theme'])('reports document-level %s changes', (key) => {
    const before = model(p())
    const after = { ...before, maps: { ...before.maps, docx: new Map([[key, packJml(['w:futureProperty', { 'w:val': 'new' }])]]) } }
    const diff = diffDocxModels(before, after)
    expect(diff.identical).toBe(false)
    expect(notes(diff)).not.toHaveLength(0)
  })

  it('includes style-only changes in identical and catches unknown definition properties', () => {
    const before = model(p())
    const after = { ...before, maps: { ...before.maps, styles: new Map([['style:Custom', packJml(['w:style', { 'w:styleId': 'Custom', 'w:type': 'paragraph' }])]]) } }
    expect(diffDocxModels(before, after).identical).toBe(false)
  })

  it('canonically compares unmodeled package XML without treating rsids as edits', async () => {
    const original = new Uint8Array(readFileSync(join(process.cwd(), 'fixtures/docx/tables.docx')))
    const pkg = OoxmlPackage.read(original)
    const document = pkg.xml('word/document.xml')!
    document.getElementsByTagName('w:p').item(0)!.setAttribute('w:rsidR', 'FFFFFF')
    const benign = pkg.write()
    expect((await diffDocxFiles(original, benign, new MemoryAssetStore())).identical).toBe(true)
    pkg.set('word/custom.xml', new TextEncoder().encode('<custom><value>Changed</value></custom>'))
    const diff = await diffDocxFiles(benign, pkg.write(), new MemoryAssetStore())
    expect(diff.identical).toBe(false)
    expect(notes(diff)).not.toHaveLength(0)
  })

  it('ignores package bookkeeping but keeps meaningful metadata visible', async () => {
    const original = new Uint8Array(readFileSync(join(process.cwd(), 'fixtures/docx/tables.docx')))
    const pkg = OoxmlPackage.read(original)
    const core = (modified: string, title: string) => `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dc="http://purl.org/dc/elements/1.1/"><dcterms:modified>${modified}</dcterms:modified><dc:title>${title}</dc:title></cp:coreProperties>`
    pkg.setXml('docProps/core.xml', core('2026-01-01T00:00:00Z', 'Title'))
    const before = pkg.write()
    pkg.setXml('docProps/core.xml', core('2026-02-01T00:00:00Z', 'Title'))
    const relationships = pkg.xml('word/_rels/document.xml.rels')!.documentElement!
    if (relationships.lastChild) relationships.insertBefore(relationships.lastChild, relationships.firstChild)
    expect((await diffDocxFiles(before, pkg.write(), new MemoryAssetStore())).identical).toBe(true)
    pkg.setXml('docProps/core.xml', core('2026-02-01T00:00:00Z', 'Changed title'))
    expect((await diffDocxFiles(before, pkg.write(), new MemoryAssetStore())).identical).toBe(false)
  })

  async function hundredPageFixture() {
    const assets = new MemoryAssetStore()
    const imported = await importDocx(new Uint8Array(readFileSync(join(process.cwd(), 'fixtures/docx/tables.docx'))), assets)
    const paragraphs = Array.from({ length: 1200 }, (_, index) => schema.node('paragraph', index % 12 === 0 ? { pageBreakBefore: packJml(['w:pageBreakBefore', {}]) } : {},
      schema.text(`Page ${Math.floor(index / 12) + 1}, paragraph ${index}. ` + 'A representative sentence with several words for the document review. '.repeat(4))))
    const before = { ...imported, body: schema.node('doc', null, paragraphs) }
    // Independent trees model two imported versions; reference equality cannot hide the cost.
    const independent = schema.nodeFromJSON(before.body.toJSON())
    const after = { ...imported, body: schema.node('doc', null, independent.content.content.map((node) => node.type.create({ ...node.attrs, jc: packJml(['w:jc', { 'w:val': 'center' }]) }, node.content))) }
    return { assets, before, after }
  }

  it('reviews all paragraph formatting changes in a roughly 100-page model within one second', async () => {
    const { before, after } = await hundredPageFixture()
    const start = performance.now()
    const diff = diffDocxModels(before, after)
    const elapsed = performance.now() - start
    expect(diff.identical).toBe(false)
    expect(diff.stats.changedBlocks).toBe(1200)
    expect(elapsed).toBeLessThan(1000)
  })

  it('does not serialize a large content-control ancestor once per paragraph', async () => {
    const { before, after } = await hundredPageFixture()
    const control = packJml(['w:sdt', {}, ['w:sdtPr', {}, ['w:dropDownList', {}, ...Array.from({ length: 1000 }, (_, index): JmlElement => ['w:listItem', { 'w:displayText': `A preserved choice ${index}`, 'w:value': String(index) }])]], '\u0000'])
    const wrap = (doc: ProseMirrorNode, v = control) => schema.node('doc', null, schema.node('blockWrapper', { v }, doc.content))
    const wrappedBefore = { ...before, body: wrap(before.body) }
    const variants = [wrap(after.body), wrap(before.body, control.replace('A preserved choice 0', 'A changed choice 0'))]
    for (const body of variants) {
      const start = performance.now()
      const diff = diffDocxModels(wrappedBefore, { ...after, body })
      expect(performance.now() - start).toBeLessThan(1000)
      expect(diff.identical).toBe(false)
      expect(diff.stats.changedBlocks).toBe(1200)
    }
  })

  it('keeps per-occurrence locations when ancestor descriptions are reused', () => {
    const sharedBefore = table()
    const sharedAfter = changes[0]![1]
    const diff = diffDocxModels(model(sharedBefore, sharedBefore), model(sharedAfter, sharedAfter))
    const tableNumbers = notes(diff).filter((note) => note.property === 'tblW').map((note) => note.location?.[0]?.index)
    expect(tableNumbers.join('|')).toBe('1|2')
  })

  it('reviews a roughly 100-page file, including canonical package comparisons, within 2.5 seconds', async () => {
    const { assets, before, after } = await hundredPageFixture()
    const left = await exportDocx(before, assets, 'docx', { regenerate: true })
    const right = await exportDocx(after, assets, 'docx', { regenerate: true })
    const start = performance.now()
    const diff = await diffDocxFiles(left, right, assets)
    const elapsed = performance.now() - start
    expect(diff.identical).toBe(false)
    expect(diff.stats.changedBlocks).toBe(1200)
    expect(elapsed).toBeLessThan(2500)
  })

  it.each(['tables.docx', 'sections-headers.docx', 'notes-fields.docx'])('never hides meaningful exported XML mutations in %s', process.env.PULPO_DOCX_FIDELITY === '1' ? { timeout: 60_000 } : {}, async (fixture) => {
    const assets = new MemoryAssetStore()
    const before = await importDocx(new Uint8Array(readFileSync(join(process.cwd(), 'fixtures/docx', fixture))), assets)
    const bytes = await exportDocx(before, assets, 'docx', { regenerate: true })
    const original = OoxmlPackage.read(bytes)
    let seed = 942
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
    const candidates: { story?: string; doc: ProseMirrorNode; pos: number; node: ProseMirrorNode }[] = []
    const collect = (doc: ProseMirrorNode, story?: string) => doc.descendants((node, pos) => {
      if ('xmlAttrs' in node.attrs) candidates.push({ story, doc, pos, node })
    })
    collect(before.body)
    for (const [id, story] of before.stories) collect(story.doc, id)
    let meaningful = 0
    const trials = process.env.PULPO_DOCX_FIDELITY === '1' ? 64 : 8
    for (let trial = 0; trial < trials; trial++) {
      const candidate = candidates[Math.floor(random() * candidates.length)]!
      const fields = ['xmlAttrs', 'lead', 'trail', 'cellTrail', 'rowTrail', 'pPrRest', 'markRPr', 'pPrChange', 'sectPr', 'tblPr', 'tblGrid', 'trPr', 'tblPrEx', 'tcPr'].filter((key) => key in candidate.node.attrs)
      const key = fields[Math.floor(random() * fields.length)]!
      const arrayField = ['lead', 'trail', 'cellTrail', 'rowTrail', 'pPrRest'].includes(key)
      const existing = candidate.node.attrs[key] ? JSON.parse(candidate.node.attrs[key]) : undefined
      const mutation: JmlElement = ['w:mutation', { 'w:val': String(Math.floor(random() * 10000)) }]
      const value = key === 'xmlAttrs' ? JSON.stringify({ ...existing, [`w:mutation${trial}`]: mutation[1]['w:val'] }) :
        packJml(arrayField ? [...(existing ?? []), mutation] : [...(existing ?? [`w:${key === 'markRPr' ? 'rPr' : key}`, {}]), mutation])
      const state = EditorState.create({ schema, doc: candidate.doc })
      const changed = state.tr.setNodeMarkup(candidate.pos, undefined, { ...candidate.node.attrs, [key]: value }).doc
      const after = { ...before, stories: new Map(before.stories), body: candidate.story ? before.body : changed }
      if (candidate.story) after.stories.set(candidate.story, { ...before.stories.get(candidate.story)!, doc: changed })
      const exported = OoxmlPackage.read(await exportDocx(after, assets, 'docx', { regenerate: true }))
      // Some schema attributes are normalized away by export. Only assert the implication
      // when the new non-rsid attribute/element survives in the actual exported XML.
      if (!original.paths().some((path) => path.endsWith('.xml') && original.text(path) !== exported.text(path) && exported.text(path)?.includes('w:mutation'))) continue
      meaningful++
      const diff = diffDocxModels(before, after)
      expect(diff.identical, `${fixture} trial ${trial}, ${candidate.node.type.name}.${key}`).toBe(false)
      expect(diff.blocks.some((block) => block.kind !== 'equal') || diff.stories.length > 0 || notes(diff).length > 0).toBe(true)
    }
    expect(meaningful).toBeGreaterThan(trials / 2)
  })
})
