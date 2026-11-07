import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Slice } from '@tiptap/pm/model'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { strToU8 } from 'fflate'
import { OoxmlPackage, resolveTarget } from '../ooxml/package.js'
import { blankDocx } from './blank.js'
import { docxCodec, referencedAssets } from './codec.js'
import { copyRelatedParts, receiveCopiedParts } from './copy-relationships.js'
import { newInlinePicture } from './drawing.js'
import { exportDocx, sha256Hex } from './export.js'
import { elementToJml, jmlToXml, packJml, type JmlElement } from './jsonml.js'
import { MemoryAssetStore } from './memory-assets.js'
import { BODY_FRAGMENT, readDocxModel, storyFragmentName, writeFragment } from './model.js'
import { NEW_PART_NAMESPACES, REL } from './names.js'
import { COPY_RELATIONSHIPS, manifestsIn, relationshipReferences } from './relationships.js'
import { docxSchema, packMarks } from './schema.js'
import { withoutForeignParts } from './view/clipboard.js'

const schema = docxSchema()
const main = 'word/document.xml'
const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==', 'base64'))
const fallback = new Uint8Array(readFileSync('fixtures/docx/objects.docx'))
const chartType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'
const chartXml = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Series</c:v></c:tx><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>5</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`

async function source(kind: 'vml' | 'alternate' | 'chart') {
  const pkg = OoxmlPackage.read(fallback)
  pkg.set('word/media/source.png', image)
  pkg.setContentType('word/media/source.png', 'image/png')
  const imageId = pkg.addRelationship(main, REL.image, 'media/source.png')
  const otherId = pkg.addRelationship(main, REL.image, 'media/other.png')
  // A distinct valid image verifies alternate branches aren't all rebound to the primary src.
  const existingImage = pkg.paths().find((path) => path.startsWith('word/media/') && path !== 'word/media/source.png')!
  const other = pkg.get(existingImage) ?? image
  pkg.set('word/media/other.png', other)
  pkg.setContentType('word/media/other.png', 'image/png')
  const vml = `<w:pict><v:shape id="Picture" type="#_x0000_t75" style="width:72pt;height:72pt"><v:imagedata r:id="${imageId}" o:title=""/><v:fill o:relid="${otherId}"/></v:shape></w:pict>`
  let xml = vml
  if (kind === 'alternate') xml = `<mc:AlternateContent><mc:Choice Requires="pic">${jmlToXml(newInlinePicture(72, 72, 'Picture')).replaceAll('rIdPulpoNew', imageId)}</mc:Choice><mc:Fallback>${vml}</mc:Fallback></mc:AlternateContent>`
  if (kind === 'chart') {
    pkg.set('word/charts/chart1.xml', strToU8(chartXml))
    pkg.setContentType('word/charts/chart1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
    // Recursive graph: chart -> image, external link, and a cycle. Keep every relationship,
    // including unused opaque extension relationships, without fetching external content.
    pkg.addRelationship('word/charts/chart1.xml', REL.image, '../media/other.png')
    pkg.addRelationship('word/charts/chart1.xml', REL.hyperlink, 'https://example.invalid/never-fetch', 'External')
    pkg.addRelationship('word/charts/chart1.xml', chartType, 'chart1.xml')
    const chartId = pkg.addRelationship(main, chartType, 'charts/chart1.xml')
    xml = `<w:drawing><wp:inline><wp:extent cx="3657600" cy="2743200"/><wp:docPr id="90" name="Chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${chartId}"/></a:graphicData></a:graphic></wp:inline></w:drawing>`
  }
  pkg.setXml(main, `<w:document ${Object.entries({ ...NEW_PART_NAMESPACES, 'xmlns:wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'xmlns:c': 'http://schemas.openxmlformats.org/drawingml/2006/chart' }).map(([key, value]) => `${key}="${value}"`).join(' ')}><w:body><w:p><w:r>${xml}</w:r></w:p><w:sectPr/></w:body></w:document>`)
  const doc = new Y.Doc()
  const assets = new MemoryAssetStore()
  await docxCodec.importFile(doc, pkg.write(), { name: 'source.docx', assets })
  return { doc, assets, imageHash: await sha256Hex(image), otherHash: await sha256Hex(other) }
}

async function copiedExport(kind: 'vml' | 'alternate' | 'chart', story = false) {
  const from = await source(kind)
  const assets = new MemoryAssetStore()
  const doc = new Y.Doc()
  await docxCodec.createEmpty(doc, { name: 'destination.docx', assets })
  const copied = await copyRelatedParts(new Slice(readDocxModel(from.doc).body.content, 0, 0), from.doc, from.assets)
  const slice = withoutForeignParts(await receiveCopiedParts(copied, assets))
  expect(slice.content.size).toBeGreaterThan(2)
  const part = story ? 'word/header1.xml' : main
  if (story) {
    doc.getMap('stories').set('header:1', JSON.stringify({ kind: 'header', part }))
    doc.getMap('rels').set('rHeader', JSON.stringify({ type: REL.header, target: 'header1.xml' }))
    doc.getMap('docx').set('sectPr', packJml(['w:sectPr', {}, ['w:headerReference', { 'w:type': 'default', 'r:id': 'rHeader' }]]))
  }
  writeFragment(doc, doc.getXmlFragment(story ? storyFragmentName('header:1') : BODY_FRAGMENT), schema.node('doc', null, slice.content))
  const bytes = await docxCodec.exportFile(doc, { name: 'destination.docx', assets })
  return { ...from, sourceDoc: from.doc, doc, assets, bytes, part, copied }
}

function assertResolved(pkg: OoxmlPackage, path: string, seen = new Set<string>()) {
  if (seen.has(path)) return
  seen.add(path)
  const xml = pkg.xml(path)?.documentElement
  if (xml) for (const ref of relationshipReferences(elementToJml(xml))) {
    expect(pkg.relationships(path).some((rel) => rel.id === ref.id), `${path}: ${ref.attribute}=${ref.id}`).toBe(true)
  }
  for (const rel of pkg.relationships(path)) {
    if (rel.targetMode === 'External') continue
    const target = resolveTarget(path, rel.target)
    expect(pkg.has(target), `${path} -> ${target}`).toBe(true)
    if (/xml/.test(pkg.contentType(target) ?? '')) assertResolved(pkg, target, seen)
  }
}

describe('copied XML relationships', () => {
  it('collects every reference recursively, including VML, alternate branches, chart and OLE', () => {
    const xml: JmlElement = ['mc:AlternateContent', {}, ['mc:Choice', {}, ['a:blip', { 'r:embed': 'image', 'r:link': 'external' }], ['c:chart', { 'r:id': 'chart' }]], ['mc:Fallback', {}, ['v:imagedata', { 'r:id': 'vml' }], ['v:fill', { 'o:relid': 'fill' }], ['o:OLEObject', { 'r:id': 'ole' }]]]
    expect(relationshipReferences(packJml(xml)).map((ref) => ref.id)).toEqual(['image', 'external', 'chart', 'vml', 'fill', 'ole'])
  })

  it.each(['vml', 'alternate', 'chart'] as const)('copies %s with all relationships to a new document and a header', async (kind) => {
    for (const story of [false, true]) {
      const result = await copiedExport(kind, story)
      try {
        const pkg = OoxmlPackage.read(result.bytes)
        assertResolved(pkg, result.part)
        expect(pkg.text(result.part)).not.toContain(COPY_RELATIONSHIPS)
        const refs = relationshipReferences(elementToJml(pkg.xml(result.part)!.documentElement!))
        const hashes = await Promise.all(refs.map(async (ref) => {
          const rel = pkg.relationships(result.part).find((rel) => rel.id === ref.id)!
          return rel.type === REL.image ? sha256Hex(pkg.get(resolveTarget(result.part, rel.target))!) : ''
        }))
        if (kind !== 'chart') {
          expect(hashes).toContain(result.imageHash)
          expect(hashes).toContain(result.otherHash)
        } else {
          const chart = pkg.relationships(result.part).find((rel) => rel.type === chartType)!
          const chartPath = resolveTarget(result.part, chart.target)
          expect(pkg.text(chartPath)).toBe(chartXml)
          expect(pkg.relationships(chartPath).some((rel) => rel.targetMode === 'External')).toBe(true)
        }
        // Re-copy portable XML, then remove it: assets must follow the live references.
        const current = readDocxModel(result.doc)
        const node = story ? current.stories.get('header:1')!.doc : current.body
        const again = await copyRelatedParts(new Slice(node.content, 0, 0), result.doc, result.assets, story ? 'header:1' : 'body')
        expect(Object.keys(again.assets).length).toBeGreaterThan(0)
        const retained = [...manifestsIn(node.firstChild!.firstChild!.attrs.v)].flatMap((manifest) => Object.values(manifest.parts).map((part) => part.hash))
        for (const hash of retained) expect(referencedAssets(result.doc).has(hash)).toBe(true)
        writeFragment(result.doc, result.doc.getXmlFragment(story ? storyFragmentName('header:1') : BODY_FRAGMENT), schema.node('doc', null, [schema.node('paragraph')]))
        for (const hash of retained) expect(referencedAssets(result.doc).has(hash)).toBe(false)
      } finally { result.doc.destroy(); result.sourceDoc.destroy() }
    }
  })

  it('remaps references in table, row, cell and paragraph properties, text marks and packed atom marks', async () => {
    const from = await source('vml')
    const imageRel = [...from.doc.getMap<string>('rels')].map(([id, json]) => ({ id, ...JSON.parse(json) })).find((rel) => rel.type === REL.image)!
    const extension = ['x:reference', { 'xmlns:x': 'urn:pulpo-test', 'r:id': imageRel.id }] as JmlElement
    const properties = (name: string) => packJml([name, {}, extension])
    const mark = schema.mark('rPrRest', { v: packJml([extension]) })
    const body = schema.node('doc', null, [schema.node('table', { tblPr: properties('w:tblPr') }, [
      schema.node('tableRow', { trPr: properties('w:trPr') }, [schema.node('tableCell', { tcPr: properties('w:tcPr') }, [
        schema.node('paragraph', { pPrRest: packJml([extension]) }, [schema.text('Text', [mark]), schema.node('tab', { marks: packMarks([schema.mark('rPrRest', { v: packJml([['x:atom', extension[1]]]) })]) })]),
      ])]),
    ])])
    writeFragment(from.doc, from.doc.getXmlFragment(BODY_FRAGMENT), body)
    const assets = new MemoryAssetStore()
    const doc = new Y.Doc()
    try {
      await docxCodec.createEmpty(doc, { name: 'target.docx', assets })
      const copied = await copyRelatedParts(new Slice(body.content, 0, 0), from.doc, from.assets)
      const slice = withoutForeignParts(await receiveCopiedParts(copied, assets))
      writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), schema.node('doc', null, slice.content))
      const pkg = OoxmlPackage.read(await docxCodec.exportFile(doc, { name: 'target.docx', assets }))
      assertResolved(pkg, main)
      expect(relationshipReferences(elementToJml(pkg.xml(main)!.documentElement!))).toHaveLength(6)
      expect(pkg.text(main)).not.toContain(COPY_RELATIONSHIPS)
      const hashes = Object.keys(copied.assets)
      expect(hashes).toHaveLength(1)
      expect(referencedAssets(doc).has(hashes[0]!)).toBe(true)
      writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), schema.node('doc', null, [schema.node('paragraph')]))
      expect(referencedAssets(doc).has(hashes[0]!)).toBe(false)
    } finally { doc.destroy(); from.doc.destroy() }
  })

  it('rejects asset bytes that do not match the copied hash before uploading', async () => {
    const assets = new MemoryAssetStore()
    const put = vi.spyOn(assets, 'put')
    await expect(receiveCopiedParts({ slice: Slice.empty, assets: { ['a'.repeat(64)]: { data: btoa('wrong bytes'), contentType: 'image/png' } } }, assets)).rejects.toThrow('Invalid copied asset')
    expect(put).not.toHaveBeenCalled()
  })

  it('does not accept private relationship metadata from an imported file', async () => {
    const pkg = OoxmlPackage.read(blankDocx())
    const root = pkg.xml(main)!
    root.getElementsByTagName('w:p').item(0)!.setAttributeNS('urn:pulpo:copy', COPY_RELATIONSHIPS, '{"version":1,"rels":{},"parts":{}}')
    const doc = new Y.Doc()
    try {
      await docxCodec.importFile(doc, pkg.write(), { name: 'untrusted.docx', assets: new MemoryAssetStore() })
      expect(JSON.stringify(readDocxModel(doc).body.toJSON())).not.toContain(COPY_RELATIONSHIPS)
    } finally { doc.destroy() }
  })

  it('rebinds a legacy VML-only picture by its asset hash without clipboard metadata', async () => {
    const from = await source('vml')
    const model = readDocxModel(from.doc)
    const drawing = model.body.firstChild!.firstChild!
    const assets = from.assets
    const doc = new Y.Doc()
    await docxCodec.createEmpty(doc, { name: 'legacy.docx', assets })
    writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), schema.node('doc', null, [schema.node('paragraph', null, drawing)]))
    const pkg = OoxmlPackage.read(await exportDocx(readDocxModel(doc), assets))
    assertResolved(pkg, main)
    doc.destroy(); from.doc.destroy()
  })

  it.runIf(process.env.PULPO_DOCX_FIDELITY === '1')('reopens copied VML, alternate pictures and charts in python-docx and LibreOffice', { timeout: 240_000 }, async () => {
    const work = mkdtempSync(join(tmpdir(), 'pulpo-docx-copied-'))
    const python = process.env.PULPO_DOCX_PYTHON ?? '/tmp/pulpo-docx-venv/bin/python'
    for (const kind of ['vml', 'alternate', 'chart'] as const) {
      const result = await copiedExport(kind, true)
      try {
        const path = join(work, `${kind}.docx`)
        writeFileSync(path, result.bytes)
        const reopened = spawnSync(python, ['-I', '-c', 'import sys,zipfile; from docx import Document; p=sys.argv[1]; assert zipfile.ZipFile(p).testzip() is None; d=Document(p); print(len(d.sections[0].header.paragraphs))', path], { encoding: 'utf8', timeout: 30_000 })
        expect(reopened.status, reopened.stdout + reopened.stderr).toBe(0)
        const lo = spawnSync(python, ['-I', 'scripts/docx-fidelity/libreoffice.py', path, '--outdir', work], { encoding: 'utf8', timeout: 180_000 })
        expect(lo.status, lo.stdout + lo.stderr).toBe(0)
      } finally { result.doc.destroy(); result.sourceDoc.destroy() }
    }
  })
})
