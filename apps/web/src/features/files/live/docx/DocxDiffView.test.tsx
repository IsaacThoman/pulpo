// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { diffDocxModels, docxSchema, emptyMaps, packJml, type DocxModel } from '@pulpo/client-core/office/docx'
import { DocxDiffView } from './DocxDiffView'

const schema = docxSchema()
const paragraph = () => schema.node('paragraph', null, schema.text('Same text'))
const model = (): DocxModel => ({ body: schema.node('doc', null, [paragraph()]), maps: emptyMaps(), stories: new Map() })
afterEach(cleanup)

describe('Word redline formatting notes', () => {
  it('renders table and cell formatting at its structural location', () => {
    const before = model()
    const table = (shade: string) => schema.node('table', null, [schema.node('tableRow', null, [schema.node('tableCell', { tcPr: packJml(['w:tcPr', {}, ['w:shd', { 'w:fill': shade }]]) }, [paragraph()])])])
    before.body = schema.node('doc', null, [table('FFFFFF')])
    const after = { ...before, body: schema.node('doc', null, [table('FF0000')]) }
    render(<DocxDiffView diff={diffDocxModels(before, after)} />)
    expect(screen.queryByText('No changes')).toBeNull()
    expect(screen.getByText('Shading')).toBeTruthy()
    expect(document.body.textContent).toContain('Table 1 › Row 1 › Cell 1')
    expect(document.body.textContent).toContain('fill=FFFFFF → fill=FF0000')
  })

  it('renders story formatting and picture notes even when the words are unchanged', () => {
    const before = model()
    const story = (bold: boolean, src: string) => ({ meta: { kind: 'header' as const }, doc: schema.node('doc', null, [schema.node('paragraph', null, [
      schema.text('Same text', bold ? [schema.mark('b', { v: packJml(['w:b', {}]) })] : []),
      schema.node('drawing', { src, v: packJml(['w:drawing', {}]) }),
    ])]) })
    before.stories.set('header:1', story(false, 'old'))
    const after = { ...before, stories: new Map([['header:1', story(true, 'new')]]) }
    render(<DocxDiffView diff={diffDocxModels(before, after)} />)
    expect(screen.queryByText('No changes')).toBeNull()
    expect(screen.getByText('Header')).toBeTruthy()
    expect(screen.getByText('Bold')).toBeTruthy()
    expect(screen.getByText('Picture')).toBeTruthy()
  })

  it('makes formatting notes beyond the first eight expandable', () => {
    const before = model()
    const diff = diffDocxModels(before, before)
    diff.identical = false
    diff.formats = [...Array.from({ length: 8 }, () => ({ property: 'formatting', text: '' })), { property: 'picture', text: '' }]
    render(<DocxDiffView diff={diff} />)
    const summary = screen.getByText('1 more formatting changes')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    expect(screen.getByText('Picture')).toBeTruthy()
  })

  it('renders generic preserved-content and document layout fallbacks', () => {
    const before = model()
    const after = { ...before, body: schema.node('doc', null, [schema.node('paragraph', { pPrRest: packJml([['w:future', { 'w:val': 'changed' }]]) }, schema.text('Same text'))]), maps: { ...before.maps, docx: new Map([['sectPr', packJml(['w:sectPr', {}, ['w:pgSz', { 'w:w': '16000' }]])]]) } }
    render(<DocxDiffView diff={diffDocxModels(before, after)} />)
    expect(screen.queryByText('No changes')).toBeNull()
    expect(screen.getByText('Formatting changed')).toBeTruthy()
    expect(screen.getByText('Layout changed')).toBeTruthy()
  })
})
