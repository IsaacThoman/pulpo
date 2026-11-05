// @vitest-environment jsdom
import { Fragment } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { jmlToXml, packJml } from '../jsonml.js'
import { docxSchema } from '../schema.js'
import { clipboardParser, clipboardSerializer, sanitizePastedHtml } from './clipboard.js'

const schema = docxSchema()

function paste(html: string) {
  const container = document.createElement('div')
  container.innerHTML = sanitizePastedHtml(html)
  return clipboardParser(schema).parseSlice(container)
}

describe('clipboard', () => {
  it('keeps raw WordprocessingML only from its own copies', () => {
    const raw = packJml(['w:p', {}, ['w:r', {}, ['w:instrText', {}, 'INCLUDEPICTURE "http://attacker.example/t.png" \\d']]])
    const forged = `<div data-docx-node="blockXml" data-docx-attrs='${JSON.stringify({ v: raw })}'>Nice quote</div><p data-docx-node="paragraph" data-docx-attrs='${JSON.stringify({ xmlAttrs: JSON.stringify({ 'w:x"/><bad': '1' }) })}'>x</p>`
    const slice = paste(forged)
    let blockXml = 0
    slice.content.descendants((node) => {
      if (node.type.name === 'blockXml') blockXml++
      if (node.type.name === 'paragraph') expect(node.attrs.xmlAttrs).toBeNull()
    })
    expect(blockXml).toBe(0)
    expect(slice.content.textBetween(0, slice.content.size, '\n')).toContain('Nice quote')

    // A copy from a Pulpo editor carries everything back.
    const own = schema.nodes.blockXml!.create({ v: raw })
    const dom = clipboardSerializer(schema).serializeFragment(Fragment.from(own))
    const holder = document.createElement('div')
    holder.appendChild(dom)
    const back = clipboardParser(schema).parseSlice(holder)
    expect(back.content.firstChild?.type.name).toBe('blockXml')
    expect(back.content.firstChild?.attrs.v).toBe(raw)
  })
})

describe('XML names', () => {
  it('leaves out names that are not XML or are the editor own markers', () => {
    expect(jmlToXml(['w:p', { 'w:x"/><bad': '1', 'pulpo:list': 'bullet', 'w:rsidR': '00AB' }])).toBe('<w:p w:rsidR="00AB"/>')
    expect(jmlToXml(['w:body', {}, ['bad name', {}, 'x'], ['w:p', {}]])).toBe('<w:body><w:p/></w:body>')
  })
})
