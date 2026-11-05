// @vitest-environment jsdom
import { Fragment, Slice } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { jmlToXml, packJml } from '../jsonml.js'
import { docxSchema } from '../schema.js'
import { clipboardParser, clipboardSerializer, limitPastedTables, recallCopy, rememberCopy, sanitizePastedHtml, withoutForeignParts, withoutStoryReferences } from './clipboard.js'

const schema = docxSchema()

function paste(html: string) {
  const container = document.createElement('div')
  container.innerHTML = sanitizePastedHtml(html)
  return limitPastedTables(clipboardParser(schema).parseSlice(container))
}

function copy(slice: Slice, origin = 'doc:body'): string {
  rememberCopy(slice, origin)
  const holder = document.createElement('div')
  holder.appendChild(clipboardSerializer(schema).serializeFragment(slice.content))
  return holder.innerHTML
}

describe('clipboard', () => {
  const raw = packJml(['w:p', {}, ['w:r', {}, ['w:instrText', {}, 'INCLUDEPICTURE "http://attacker.example/t.png" \\d']]])

  it('pastes its own copies back exactly, from memory rather than the clipboard', () => {
    const slice = new Slice(Fragment.from(schema.nodes.blockXml!.create({ v: raw })), 0, 0)
    const html = copy(slice)
    expect(html).not.toContain('INCLUDEPICTURE')
    const back = recallCopy(html, schema)
    expect(back?.origin).toBe('doc:body')
    expect(back?.slice.content.firstChild?.type.name).toBe('blockXml')
    expect(back?.slice.content.firstChild?.attrs.v).toBe(raw)
    // Another tab of this origin finds the latest copy in local storage (where the test environment has one).
    const storage = (globalThis as { localStorage?: Storage }).localStorage
    if (storage?.getItem) expect(JSON.parse(storage.getItem('pulpo-docx-copy')!).json).toContain('INCLUDEPICTURE')
  })

  it('treats anything else as ordinary pasted HTML', () => {
    // Attributes like the old internal format, an unknown copy id, and a known-looking id with
    // made-up content: none is trusted.
    const forged = `<div data-docx-node="blockXml" data-docx-attrs='${JSON.stringify({ v: raw })}'>Nice quote</div><p data-docx-copy="${'ab'.repeat(16)}" data-docx-attrs='${JSON.stringify({ xmlAttrs: JSON.stringify({ 'w:x"/><bad': '1' }) })}'>x</p>`
    expect(recallCopy(forged, schema)).toBeNull()
    const slice = paste(forged)
    let blockXml = 0
    slice.content.descendants((node) => {
      if (node.type.name === 'blockXml') blockXml++
      if (node.type.name === 'paragraph') expect(node.attrs.xmlAttrs).toBeNull()
    })
    expect(blockXml).toBe(0)
    expect(slice.content.textBetween(0, slice.content.size, '\n')).toContain('Nice quote')
  })

  it('keeps pasted tables to a size editors can hold', () => {
    const spans = paste('<table><tr><td colspan="1000000" rowspan="99999999">a</td></tr><tr><td>b</td></tr></table>')
    const cell = spans.content.firstChild!.firstChild!.firstChild!
    expect(cell.attrs.colspan).toBe(63)
    expect(cell.attrs.rowspan).toBe(1000)
    const wide = paste(`<table><tr>${'<td colspan="63">x</td>'.repeat(5)}</tr></table><p>after</p>`)
    expect(wide.content.firstChild!.type.name).toBe('paragraph')
    expect(wide.content.textBetween(0, wide.content.size, '\n')).toBe('x\nx\nx\nx\nx\nafter')
    const tall = paste(`<table>${'<tr><td colspan="63">y</td></tr>'.repeat(4_000)}</table>`)
    expect(tall.content.firstChild!.type.name).toBe('paragraph')
  })
})

describe('content from another part', () => {
  it('keeps pictures and links but leaves out what refers to its old part', () => {
    const ole = packJml(['w:object', {}, ['o:OLEObject', { ProgID: 'Excel.Sheet.12', 'r:id': 'rId5' }]])
    const chart = packJml(['wp:inline', {}, ['a:graphic', {}, ['a:graphicData', {}, ['c:chart', { 'r:id': 'rId9' }]]]])
    const picture = packJml(['wp:inline', {}, ['a:graphic', {}, ['a:graphicData', {}, ['pic:pic', {}, ['pic:blipFill', {}, ['a:blip', { 'r:embed': 'rId3' }]]]]]])
    const sectPr = packJml(['w:sectPr', {}, ['w:headerReference', { 'w:type': 'default', 'r:id': 'rId7' }]])
    const link = schema.marks.link!.create({ href: 'https://example.com/', v: packJml(['w:hyperlink', { 'r:id': 'rId2' }, '\u0000']) })
    const paragraph = schema.nodes.paragraph!.create({ sectPr }, [
      schema.text('Linked', [link]),
      schema.nodes.inlineXml!.create({ v: ole }),
      schema.nodes.drawing!.create({ v: chart }),
      schema.nodes.drawing!.create({ v: picture, src: 'a'.repeat(64) }),
    ])
    const cell = schema.nodes.tableCell!.create(null, [schema.nodes.blockXml!.create({ v: ole })])
    const table = schema.nodes.table!.create(null, [schema.nodes.tableRow!.create(null, [cell])])
    const cleaned = withoutForeignParts(new Slice(Fragment.from([paragraph, table]), 0, 0))
    const kept = cleaned.content.firstChild!
    expect(kept.attrs.sectPr).toBeNull()
    const inline: string[] = []
    kept.forEach((child) => inline.push(child.isText ? `text:${child.marks.map((mark) => mark.type.name).join()}` : child.type.name))
    expect(inline).toEqual(['text:link', 'drawing'])
    // The cell lost its only block and got an empty paragraph instead.
    expect(cleaned.content.lastChild!.firstChild!.firstChild!.firstChild!.type.name).toBe('paragraph')
  })

  it('strips document story references recursively while keeping text, formatting and slice openness', () => {
    const paragraph = schema.node('paragraph', null, [
      schema.node('commentMark', { edge: 'start', id: '1' }),
      schema.text('Keep this', [schema.mark('b')]),
      schema.node('noteRef', { kind: 'footnote', id: '1' }),
      schema.node('noteRef', { kind: 'endnote', id: '2' }),
      schema.node('commentMark', { edge: 'end', id: '1' }),
      schema.node('commentMark', { edge: 'ref', id: '1' }),
    ])
    const table = schema.node('table', null, [schema.node('tableRow', null, [schema.node('tableCell', null, [paragraph])])])
    const slice = new Slice(Fragment.from([paragraph, table]), 1, 3)
    const cleaned = withoutStoryReferences(slice)
    const names: string[] = []
    cleaned.content.descendants((node) => { names.push(node.type.name) })
    expect(names).not.toContain('noteRef')
    expect(names).not.toContain('commentMark')
    expect(cleaned.openStart).toBe(1)
    expect(cleaned.openEnd).toBe(3)
    expect(cleaned.content.firstChild!.firstChild!.eq(paragraph.child(1))).toBe(true)
    expect(cleaned.content.lastChild!.firstChild!.firstChild!.firstChild!.eq(cleaned.content.firstChild!)).toBe(true)
    // Recalling within the source document keeps the original references available.
    expect(recallCopy(copy(slice), schema)?.slice.eq(slice)).toBe(true)
  })

  it('nests pasted tables no deeper than a document may', () => {
    let html = 'x'
    for (let level = 0; level < 40; level++) html = `<table><tr><td>${html}</td></tr></table>`
    const depthOf = (slice: Slice) => {
      let deepest = 0
      const visit = (node: ReturnType<Slice['content']['child']>, depth: number) => {
        const here = node.type.name === 'table' ? depth + 1 : depth
        deepest = Math.max(deepest, here)
        node.forEach((child) => visit(child, here))
      }
      slice.content.forEach((child) => visit(child, 0))
      return deepest
    }
    const container = document.createElement('div')
    container.innerHTML = html
    const parsed = clipboardParser(schema).parseSlice(container)
    expect(depthOf(limitPastedTables(parsed))).toBe(30)
    expect(depthOf(limitPastedTables(parsed, 5))).toBe(5)
  })
})

describe('XML names', () => {
  it('leaves out names that are not XML or are the editor own markers', () => {
    expect(jmlToXml(['w:p', { 'w:x"/><bad': '1', 'pulpo:list': 'bullet', 'w:rsidR': '00AB' }])).toBe('<w:p w:rsidR="00AB"/>')
    expect(jmlToXml(['w:body', {}, ['bad name', {}, 'x'], ['w:p', {}]])).toBe('<w:body><w:p/></w:body>')
  })
})
