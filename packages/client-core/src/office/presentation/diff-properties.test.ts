import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { presentationCodec } from './codec.js'
import { diffDocuments, diffFiles } from './diff.js'
import { readPresentation } from './read.js'
import { memoryAssets } from './testing/assets.js'
import { fixture } from './testing/fixtures.js'
import { childElements, parseXmlDocument, serializeNode, type XmlElement } from './xml.js'

describe('complete slide review comparison', () => {
  it('reports changes in a chart’s embedded workbook even when its slide and chart XML stay identical', async () => {
    const before = fixture('generated/charts.pptx')
    const files = unzipSync(before)
    const part = Object.keys(files).find((path) => path.endsWith('.xlsx'))!
    const workbook = unzipSync(files[part]!)
    const sheet = Object.keys(workbook).find((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))!
    const xml = strFromU8(workbook[sheet]!)
    const changed = xml.replace(/<v>\d+<\/v>/, '<v>987654</v>')
    expect(changed).not.toBe(xml)
    workbook[sheet] = strToU8(changed)
    files[part] = zipSync(workbook)
    const diff = await diffFiles(before, zipSync(files))
    expect(diff.edited).toBeGreaterThan(0)
    expect(diff.slides.some((slide) => slide.slideChanges.includes('formatting'))).toBe(true)
  })

  it('reports preserved notes formatting as a generic slide formatting change', async () => {
    const before = fixture('generated/layouts-notes-sections.pptx')
    const files = unzipSync(before)
    const snapshot = await readPresentation(before)
    const notes = snapshot.slides.find((slide) => slide.notes?.part)!.notes!.part!
    const xml = parseXmlDocument(strFromU8(files[notes]!))
    xml.documentElement!.setAttribute('showMasterSp', '0')
    files[notes] = strToU8(serializeNode(xml))
    const diff = await diffFiles(before, zipSync(files))
    expect(diff.edited).toBeGreaterThan(0)
    expect(diff.slides.some((slide) => slide.slideChanges.includes('formatting'))).toBe(true)
  })

  it('ignores attribute and namespace declaration order throughout a deck', async () => {
    const before = fixture('generated/layouts-notes-sections.pptx')
    const files = unzipSync(before)
    for (const [path, bytes] of Object.entries(files)) {
      if (!/\.(xml|rels)$/.test(path)) continue
      const xml = parseXmlDocument(strFromU8(bytes))
      const nodes = [xml.documentElement!]
      while (nodes.length) {
        const node = nodes.pop()!
        const attributes = Array.from({ length: node.attributes.length }, (_, index) => node.attributes.item(index)!.cloneNode(true))
        for (const attribute of [...attributes].reverse()) node.removeAttributeNode(node.getAttributeNode(attribute.nodeName)!)
        for (const attribute of attributes.reverse()) node.setAttributeNodeNS(attribute as never)
        nodes.push(...childElements(node))
      }
      files[path] = strToU8(serializeNode(xml))
    }
    const diff = await diffFiles(before, zipSync(files))
    expect(diff.slides.filter((slide) => slide.status !== 'unchanged').map((slide) => ({ before: slide.before, changes: slide.slideChanges, shapes: slide.shapes }))).toEqual([])
    expect(diff.changed).toBe(false)
  })

  it('never hides meaningful exported changes under randomized preserved XML mutations', async () => {
    const before = fixture('generated/layouts-notes-sections.pptx')
    const original = unzipSync(before)
    const snapshot = await readPresentation(before)
    const paths = [...new Set(snapshot.slides.flatMap((slide) => [slide.part!, slide.layout, slide.notes?.part]).filter((path): path is string => !!path))]
    paths.push(...Object.keys(original).filter((path) => /ppt\/(slideMasters|notesMasters|theme)\/[^/]+\.xml$/.test(path)))
    let seed = 0x939c0de
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0 }
    const assets = memoryAssets()
    const docBefore = new Y.Doc()
    await presentationCodec.importFile(docBefore, before, { name: 'deck.pptx', assets })
    for (let iteration = 0; iteration < 96; iteration++) {
      const part = paths[random() % paths.length]!
      const xml = parseXmlDocument(strFromU8(original[part]!))
      const nodes: XmlElement[] = []
      const stack = [xml.documentElement!]
      while (stack.length) { const node = stack.pop()!; nodes.push(node); stack.push(...childElements(node)) }
      const token = `changed-${iteration}-${random()}`
      if (random() % 2) nodes[random() % nodes.length]!.setAttributeNS('urn:pulpo:review-test', 'probe:format', token)
      else {
        const root = xml.documentElement!
        const prefix = root.prefix ? `${root.prefix}:` : ''
        const list = childElements(root).find((node) => node.localName === 'extLst') ?? root.appendChild(xml.createElementNS(root.namespaceURI, `${prefix}extLst`))
        const extension = xml.createElementNS(root.namespaceURI, `${prefix}ext`)
        extension.setAttribute('uri', 'urn:pulpo:review-test')
        const value = xml.createElementNS('urn:pulpo:review-test', 'probe:format')
        value.setAttribute('value', token)
        extension.appendChild(value)
        list.appendChild(extension)
      }
      const modified = strToU8(serializeNode(xml))
      const docAfter = new Y.Doc()
      await presentationCodec.importFile(docAfter, zipSync({ ...original, [part]: modified }), { name: 'deck.pptx', assets })
      const exported = unzipSync(await presentationCodec.exportFile(docAfter, { name: 'deck.pptx', assets }))
      expect(strFromU8(exported[part]!), `${iteration}: mutation survives export in ${part}`).toContain(token)
      const diff = diffDocuments(docBefore, docAfter)
      expect(diff.edited, `${iteration}: ${part} must appear in review`).toBeGreaterThan(0)
      expect(diff.slides.some((slide) => slide.status === 'edited' || slide.status === 'moved')).toBe(true)
      docAfter.destroy()
    }
    docBefore.destroy()
  }, 60_000)
})
