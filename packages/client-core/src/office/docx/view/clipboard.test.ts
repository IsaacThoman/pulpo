// @vitest-environment jsdom
import { Fragment, Slice } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { jmlToXml, packJml } from '../jsonml.js'
import { docxSchema } from '../schema.js'
import { clipboardParser, clipboardSerializer, limitPastedTables, recallCopy, rememberCopy, sanitizePastedHtml } from './clipboard.js'

const schema = docxSchema()

function paste(html: string) {
  const container = document.createElement('div')
  container.innerHTML = sanitizePastedHtml(html)
  return limitPastedTables(clipboardParser(schema).parseSlice(container))
}

function copy(slice: Slice): string {
  rememberCopy(slice)
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
    expect(back?.content.firstChild?.type.name).toBe('blockXml')
    expect(back?.content.firstChild?.attrs.v).toBe(raw)
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

describe('XML names', () => {
  it('leaves out names that are not XML or are the editor own markers', () => {
    expect(jmlToXml(['w:p', { 'w:x"/><bad': '1', 'pulpo:list': 'bullet', 'w:rsidR': '00AB' }])).toBe('<w:p w:rsidR="00AB"/>')
    expect(jmlToXml(['w:body', {}, ['bad name', {}, 'x'], ['w:p', {}]])).toBe('<w:body><w:p/></w:body>')
  })
})
