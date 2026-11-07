// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { packJml } from '../jsonml.js'
import { MemoryAssetStore } from '../memory-assets.js'
import { docxSchema } from '../schema.js'
import { AssetUrls } from './assets.js'
import { listDefinition } from './commands.js'
import { DocxViewContext } from './context.js'
import { DEFAULT_DOCX_LABELS } from './labels.js'
import { renderStory } from './static.js'

const schema = docxSchema()
let doc: Y.Doc
let context: DocxViewContext
let urls: AssetUrls
beforeEach(() => {
  doc = new Y.Doc()
  doc.getMap('numbering').set('abstract:1', packJml(listDefinition('decimal', '1')))
  doc.getMap('numbering').set('num:1', packJml(['w:num', { 'w:numId': '1' }, ['w:abstractNumId', { 'w:val': '1' }]]))
  context = new DocxViewContext(doc)
  urls = new AssetUrls(new MemoryAssetStore())
})
afterEach(() => { urls.destroy(); context.destroy(); doc.destroy() })

describe('computed formatting in static stories', () => {
  it.each(['header', 'footer', 'footnote', 'endnote'])('keeps list labels and level/direct indents in a static %s', () => {
    const numPr = packJml(['w:numPr', {}, ['w:numId', { 'w:val': '1' }]])
    const paragraph = (text: string, attrs = {}) => schema.node('paragraph', { numPr, ...attrs }, schema.text(text))
    const body = schema.node('doc', null, [paragraph('First'), paragraph('Second', { ind: packJml(['w:ind', { 'w:left': '1440' }]) })])
    const rendered = renderStory(body, { urls, context, labels: DEFAULT_DOCX_LABELS })
    const paragraphs = [...rendered.querySelectorAll('p')]
    expect(paragraphs.map((p) => p.dataset.label).join('|')).toBe('1.|2.')
    expect(paragraphs[0]!.style.getPropertyValue('--docx-ind-l')).toBe('36pt')
    expect(paragraphs[1]!.style.getPropertyValue('--docx-ind-l')).toBe('72pt')
    expect(paragraphs[0]!.style.textIndent).toBe('-18pt')
  })

  it('keeps occurrence-specific numbering and contextual spacing for repeated nodes', () => {
    const item = schema.node('paragraph', { numPr: packJml(['w:numPr', {}, ['w:numId', { 'w:val': '1' }]]), contextualSpacing: packJml(['w:contextualSpacing', {}]) }, schema.text('Repeated'))
    const body = schema.node('doc', null, [item, item])
    const rendered = renderStory(body, { urls, context, labels: DEFAULT_DOCX_LABELS })
    const paragraphs = [...rendered.querySelectorAll('p')]
    expect(paragraphs.map((p) => p.dataset.label).join('|')).toBe('1.|2.')
    expect(paragraphs[0]!.style.getPropertyValue('--docx-ind-l')).toBe('36pt')
    expect(paragraphs[0]!.style.marginBottom).toBe('0px')
    expect(paragraphs[1]!.style.marginTop).toBe('0px')
  })

  it('keeps computed cell shading/borders and paragraph revisions in static tables', () => {
    const cell = schema.node('tableCell', { tcPr: packJml(['w:tcPr', {}, ['w:shd', { 'w:fill': 'FF0000' }], ['w:tcBorders', {}, ['w:top', { 'w:val': 'single', 'w:sz': '8', 'w:color': '000000' }]]]) }, [schema.node('paragraph', { markRPr: packJml(['w:rPr', {}, ['w:ins', { 'w:id': '1' }]]) }, schema.text('Cell'))])
    const body = schema.node('doc', null, [schema.node('table', null, [schema.node('tableRow', null, [cell])])])
    const rendered = renderStory(body, { urls, context, labels: DEFAULT_DOCX_LABELS })
    expect(rendered.querySelector('td')!.style.backgroundColor).toBe('rgb(255, 0, 0)')
    expect(rendered.querySelector('td')!.style.borderTopStyle).toBe('solid')
    expect(rendered.querySelector('p')!.dataset.paraRev).toBe('ins')
  })
})
