import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { fixture } from '../testing/fixtures.js'
import { attr, child, childElements, NS, parseFragment, parseXmlDocument, path, serializeNode, type XmlElement } from '../xml.js'
import { DEFAULT_COLOR_MAP } from './color.js'
import { DeckResources, DEFAULT_THEME } from './deck.js'
import { DEFAULT_RENDER_LABELS, type RenderEnv } from './env.js'
import { builtInTableStyle, BUILT_IN_TABLE_STYLES } from './table-styles.js'
import { renderTable } from './table.js'

function style(name: string): XmlElement {
  const entry = BUILT_IN_TABLE_STYLES.find((entry) => entry.name === name)
  expect(entry, name).toBeDefined()
  return parseFragment(builtInTableStyle(entry!.id)!)
}

function cellStyle(style: XmlElement, part: string): XmlElement | undefined {
  return path(style, part, 'tcStyle')
}

function fillColor(style: XmlElement, part: string): XmlElement | undefined {
  return path(cellStyle(style, part), 'fill', 'solidFill', 'schemeClr')
}

function border(style: XmlElement, part: string, side: string): XmlElement | undefined {
  return path(cellStyle(style, part), 'tcBdr', side, 'ln')
}

function environment(scheme = DEFAULT_THEME.colors): RenderEnv {
  return {
    deck: new DeckResources({}, 'ppt/presentation.xml'),
    theme: {
      ...DEFAULT_THEME,
      colors: scheme,
      lineStyles: [parseFragment('<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>')],
      fillStyles: [parseFragment('<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>')],
    },
    colors: { scheme, colorMap: DEFAULT_COLOR_MAP },
    rel: () => undefined,
    assetUrl: () => undefined,
    nextId: () => 'table-test',
    slideNumber: 1,
    mode: 'view',
    labels: DEFAULT_RENDER_LABELS,
    now: new Date(0),
  }
}

const FLAGS = ['firstRow', 'lastRow', 'firstCol', 'lastCol', 'bandRow', 'bandCol']

function table(styleId: string, flags: string, explicitStyle = '', cellProperties = ''): XmlElement {
  const row = `<a:tr h="381000">${Array.from({ length: 4 }, () => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr>${cellProperties}</a:tcPr></a:tc>`).join('')}</a:tr>`
  return parseFragment(`<a:tbl><a:tblPr ${flags}><a:tableStyleId>${styleId}</a:tableStyleId>${explicitStyle}</a:tblPr><a:tblGrid>${'<a:gridCol w="914400"/>'.repeat(4)}</a:tblGrid>${row.repeat(4)}</a:tbl>`)
}

const BOX = { w: 384, h: 160, scaleX: 1, scaleY: 1 }

describe('PowerPoint built-in table styles', () => {
  it('lists exactly 74 unique GUIDs and English names', () => {
    expect(BUILT_IN_TABLE_STYLES).toHaveLength(74)
    expect(new Set(BUILT_IN_TABLE_STYLES.map(({ id }) => id.toUpperCase())).size).toBe(74)
    expect(new Set(BUILT_IN_TABLE_STYLES.map(({ name }) => name)).size).toBe(74)
    for (const { id } of BUILT_IN_TABLE_STYLES) expect(id).toMatch(/^\{[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}\}$/)
    expect(BUILT_IN_TABLE_STYLES).toContainEqual({ id: '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}', name: 'Medium Style 2 - Accent 2' })
  })

  it('creates self-contained DrawingML with a whole-table part for every id', () => {
    for (const { id, name } of BUILT_IN_TABLE_STYLES) {
      const xml = builtInTableStyle(id)!
      const root = parseFragment(xml)
      expect(root.localName, name).toBe('tblStyle')
      expect(root.namespaceURI, name).toBe(NS.a)
      expect(attr(root, 'xmlns:a'), name).toBe(NS.a)
      expect(attr(root, 'styleId'), name).toBe(id)
      expect(attr(root, 'styleName'), name).toBe(name)
      expect(child(root, 'wholeTbl', NS.a), name).toBeDefined()
      expect(parseXmlDocument(xml).documentElement?.localName, name).toBe('tblStyle')
      expect(builtInTableStyle(id.toLowerCase()), name).toBe(xml)
      expect(builtInTableStyle(id.slice(1, -1).toLowerCase()), name).toBe(xml)
    }
  })

  it('returns undefined for unknown or malformed ids', () => {
    for (const id of ['', 'unknown', '{00000000-0000-0000-0000-000000000000}', '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A', '"><a:wholeTbl/>']) {
      expect(builtInTableStyle(id)).toBeUndefined()
    }
  })

  it('gives Light Style 1 accent borders, transparent bands, and a bold header', () => {
    const root = style('Light Style 1 - Accent 6')
    for (const side of ['top', 'bottom']) {
      expect(attr(path(border(root, 'wholeTbl', side), 'solidFill', 'schemeClr'), 'val')).toBe('accent6')
    }
    expect(attr(path(root, 'firstRow', 'tcTxStyle'), 'b')).toBe('on')
    expect(attr(fillColor(root, 'band1H'), 'val')).toBe('accent6')
    expect(attr(child(fillColor(root, 'band1H'), 'alpha'), 'val')).toBe('20000')
  })

  it.each(['Medium Style 4', 'Medium Style 4 - Accent 3'])('gives %s tinted fills and a complete grid', (name) => {
    const root = style(name)
    const ink = name === 'Medium Style 4' ? 'dk1' : 'accent3'
    expect(attr(fillColor(root, 'wholeTbl'), 'val')).toBe(ink)
    expect(attr(child(fillColor(root, 'wholeTbl'), 'tint'), 'val')).toBe('20000')
    expect(attr(child(fillColor(root, 'band1V'), 'tint'), 'val')).toBe('40000')
    for (const side of ['left', 'right', 'top', 'bottom', 'insideH', 'insideV']) {
      expect(attr(path(border(root, 'wholeTbl', side), 'solidFill', 'schemeClr'), 'val')).toBe(ink)
    }
  })

  it('uses shades and light text for Dark Style 1, and gray tints in its plain variant', () => {
    const root = style('Dark Style 1 - Accent 4')
    expect(attr(fillColor(root, 'wholeTbl'), 'val')).toBe('accent4')
    expect(attr(child(fillColor(root, 'wholeTbl'), 'shade'), 'val')).toBe('20000')
    expect(attr(child(fillColor(root, 'band1H'), 'shade'), 'val')).toBe('40000')
    expect(attr(child(fillColor(root, 'firstCol'), 'shade'), 'val')).toBe('60000')
    expect(attr(path(root, 'wholeTbl', 'tcTxStyle', 'schemeClr'), 'val')).toBe('lt1')
    expect(attr(child(fillColor(style('Dark Style 1'), 'wholeTbl'), 'tint'), 'val')).toBe('20000')
  })

  it.each([1, 3, 5])('pairs accents %s and the next accent in Dark Style 2', (accent) => {
    const root = style(`Dark Style 2 - Accent ${accent}/Accent ${accent + 1}`)
    expect(attr(fillColor(root, 'wholeTbl'), 'val')).toBe(`accent${accent}`)
    expect(attr(fillColor(root, 'firstRow'), 'val')).toBe(`accent${accent + 1}`)
  })

  it('gives No Style, No Grid no fill or painted borders', () => {
    const root = style('No Style, No Grid')
    expect(path(cellStyle(root, 'wholeTbl'), 'fill', 'noFill')).toBeDefined()
    expect(root.getElementsByTagNameNS(NS.a, 'solidFill').length).toBe(0)
    expect(root.getElementsByTagNameNS(NS.a, 'lnRef').length).toBe(0)
    for (const side of ['left', 'right', 'top', 'bottom', 'insideH', 'insideV']) {
      expect(child(border(root, 'wholeTbl', side), 'noFill')).toBeDefined()
    }
  })

  it('preserves the default Medium Style 2 formatting', () => {
    const root = style('Medium Style 2 - Accent 1')
    expect(attr(fillColor(root, 'wholeTbl'), 'val')).toBe('accent1')
    expect(attr(child(fillColor(root, 'wholeTbl'), 'tint'), 'val')).toBe('20000')
    for (const band of ['band1H', 'band1V']) expect(attr(child(fillColor(root, band), 'tint'), 'val')).toBe('40000')
    for (const side of ['left', 'right', 'top', 'bottom', 'insideH', 'insideV']) {
      expect(attr(border(root, 'wholeTbl', side), 'w')).toBe('12700')
      expect(attr(path(border(root, 'wholeTbl', side), 'solidFill', 'schemeClr'), 'val')).toBe('lt1')
    }
    for (const part of ['firstRow', 'lastRow', 'firstCol', 'lastCol']) {
      expect(attr(fillColor(root, part), 'val')).toBe('accent1')
      expect(childElements(fillColor(root, part))).toHaveLength(0)
      expect(attr(path(root, part, 'tcTxStyle'), 'b')).toBe('on')
      expect(attr(path(root, part, 'tcTxStyle', 'schemeClr'), 'val')).toBe('lt1')
    }
    expect(attr(border(root, 'firstRow', 'bottom'), 'w')).toBe('38100')
    expect(attr(border(root, 'lastRow', 'top'), 'w')).toBe('38100')
  })

  it('renders every built-in style with the deck theme', () => {
    const env = environment()
    const flags = FLAGS.map((name) => `${name}="1"`).join(' ')
    for (const { id } of BUILT_IN_TABLE_STYLES) {
      const html = renderTable(table(id.toLowerCase().slice(1, -1), flags), env, BOX)
      expect(html).not.toMatch(/NaN|undefined/)
      expect(html.match(/<td/g)).toHaveLength(16)
    }
    const id = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}'
    const red = renderTable(table(id, 'firstRow="1"'), environment({ ...DEFAULT_THEME.colors, accent1: 'FF0000' }), BOX)
    expect(red).toContain('background:rgb(255, 0, 0)')
    // DrawingML tint works in linear light before conversion back to sRGB.
    expect(red).toContain('background:rgb(255, 231, 231)')
    expect(red).toContain('border-bottom:4px solid rgb(255, 255, 255)')
    const ownFill = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'
    expect(renderTable(table(id, flags, '', ownFill), env, BOX)).toContain('background:rgb(18, 52, 86)')
  })

  it('renders like PowerPoint-authored fixture definitions with every combination of table flags', () => {
    const env = environment()
    const styles = new Map<string, XmlElement>()
    for (const name of ['poi/bug65551.pptx', 'poi/51187.pptx', 'poi/table_test2.pptx']) {
      const bytes = unzipSync(fixture(name))['ppt/tableStyles.xml']!
      const root = parseXmlDocument(new TextDecoder().decode(bytes)).documentElement!
      for (const entry of childElements(root)) styles.set(attr(entry, 'styleId')!, entry)
    }
    expect(styles.size).toBe(10)
    for (const [id, explicit] of styles) {
      for (let mask = 0; mask < 1 << FLAGS.length; mask++) {
        const flags = FLAGS.map((name, index) => `${name}="${(mask >> index) & 1}"`).join(' ')
        const fallback = renderTable(table(id, flags), env, BOX)
        const embedded = renderTable(table(id, flags, serializeNode(explicit)), env, BOX)
        expect(fallback, `${attr(explicit, 'styleName')}: ${flags}`).toBe(embedded)
      }
    }
  }, 30_000)
})
