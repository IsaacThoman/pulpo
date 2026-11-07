import { describe, expect, it } from 'vitest'
import { parseXml } from '../../ooxml/package.js'
import { DEFAULT_THEME, OFFICE_2007_THEME, type Theme } from '../../ooxml/theme.js'
import { isElement, type Element } from '../../ooxml/xml.js'
import type { Scalar } from '../formula/types.js'
import { parseChart } from './parse.js'
import { formatGeneral, renderChartSvg, type RenderChartOptions } from './render.js'
import { AXES, chartXml, fixture, fixtureResolver, numRef, strRef, testFormatNumber } from './test-data.js'

function render(xml: string, options: Partial<RenderChartOptions> = {}): string {
  return renderChartSvg(parseChart(xml), { width: 480, height: 288, idPrefix: 't', formatNumber: testFormatNumber, ...options })
}

/** Text content of every <text> element. */
function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
}

function elements(svg: string, name: string): string[] {
  return [...svg.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => m[0])
}

function fills(svg: string, name = 'rect'): string[] {
  return elements(svg, name).map((el) => /fill="([^"]*)"/.exec(el)?.[1] ?? '')
}

function bar(series: { name: string; values: (number | null)[] }[], options: { grouping?: string; barDir?: string; categories?: string[]; extra?: string } = {}): string {
  const categories = options.categories ?? series[0]!.values.map((_, i) => `C${i + 1}`)
  const body = series
    .map(
      (s, i) =>
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx>${strRef(`Sheet1!$${String.fromCharCode(66 + i)}$1`, [s.name])}</c:tx><c:cat>${strRef('Sheet1!$A$2:$A$9', categories)}</c:cat><c:val>${numRef(`Sheet1!$${String.fromCharCode(66 + i)}$2:$${String.fromCharCode(66 + i)}$9`, s.values)}</c:val></c:ser>`,
    )
    .join('')
  return chartXml(
    `<c:barChart><c:barDir val="${options.barDir ?? 'col'}"/><c:grouping val="${options.grouping ?? 'clustered'}"/>${body}${options.extra ?? ''}<c:axId val="1"/><c:axId val="2"/></c:barChart>${AXES}`,
    '',
  ).replace('</c:plotArea>', '</c:plotArea><c:legend><c:legendPos val="r"/></c:legend>')
}

const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'defs', 'clipPath', 'rect', 'path', 'line', 'circle', 'text'])
const ALLOWED_ATTRIBUTES = new Set([
  'xmlns', 'width', 'height', 'viewBox', 'font-family', 'role', 'aria-label', 'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap', 'text-anchor', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'transform', 'clip-path',
])

/** Parses the SVG and checks every element and attribute against an allowlist. */
function assertSafeSvg(svg: string): void {
  const root = parseXml(svg).documentElement!
  const stack: Element[] = [root]
  while (stack.length) {
    const element = stack.pop()!
    expect(ALLOWED_ELEMENTS.has(element.localName ?? ''), `element ${element.localName}`).toBe(true)
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i)!
      expect(ALLOWED_ATTRIBUTES.has(attr.name), `attribute ${attr.name}`).toBe(true)
      if (attr.name === 'clip-path') expect(attr.value).toMatch(/^url\(#[A-Za-z0-9_-]+\)$/)
      if (attr.name === 'fill' || attr.name === 'stroke') expect(attr.value).toMatch(/^(none|#[0-9a-f]{6}|rgba\(\d+,\d+,\d+,[0-9.]+\))$/)
    }
    for (let node = element.firstChild; node; node = node.nextSibling) if (isElement(node)) stack.push(node)
  }
}

describe('renderChartSvg: chart types', () => {
  it('draws clustered columns with theme accent colors and a legend', () => {
    const svg = render(bar([{ name: 'A', values: [1, 2, 3] }, { name: 'B', values: [3, 2, 1] }]))
    const rects = fills(svg)
    expect(rects.filter((fill) => fill === '#4472c4')).toHaveLength(4) // 3 bars + legend key
    expect(rects.filter((fill) => fill === '#ed7d31')).toHaveLength(4)
    expect(texts(svg)).toEqual(expect.arrayContaining(['A', 'B', 'C1', 'C2', 'C3', '0', '3.5']))
    assertSafeSvg(svg)
  })

  it('cycles accents with Office 2013 variations past six series', () => {
    const series = Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, values: [i + 1] }))
    const rects = fills(render(bar(series)))
    expect(rects).toContain('#264478') // accent1, lumMod 60%
    expect(rects).toContain('#9e480e') // accent2, lumMod 60%
  })

  it('uses the chart style for automatic colors', () => {
    const xml = bar([{ name: 'A', values: [1] }, { name: 'B', values: [2] }]).replace('<c:chart>', '<c:style val="3"/><c:chart>')
    const rects = fills(render(xml))
    // Style 3: shades of accent1 only.
    expect(rects).not.toContain('#ed7d31')
  })

  it('draws negative bars below the axis and inverts them when asked', () => {
    const svg = render(bar([{ name: 'A', values: [10, -10] }]))
    const [positive, negative] = elements(svg, 'rect').filter((el) => el.includes('#4472c4'))
    const y = (el: string) => Number(/ y="([^"]+)"/.exec(el)![1])
    const h = (el: string) => Number(/height="([^"]+)"/.exec(el)![1])
    expect(y(negative!)).toBeCloseTo(y(positive!) + h(positive!), 0)
    const inverted = render(bar([{ name: 'A', values: [10, -10] }]).replace('<c:cat>', '<c:invertIfNegative val="1"/><c:cat>'))
    expect(fills(inverted)).toContain('#ffffff')
  })

  it('stacks bars and reverses a side legend to match', () => {
    const svg = render(bar([{ name: 'First', values: [1, 2] }, { name: 'Second', values: [3, 4] }], { grouping: 'stacked' }))
    const labels = texts(svg)
    expect(labels.indexOf('Second')).toBeLessThan(labels.indexOf('First'))
  })

  it('scales percent-stacked charts to 100%', () => {
    const svg = render(bar([{ name: 'A', values: [1, 3] }, { name: 'B', values: [1, 1] }], { grouping: 'percentStacked' }))
    expect(texts(svg)).toEqual(expect.arrayContaining(['0%', '100%']))
  })

  it('draws horizontal bars with categories bottom to top', () => {
    const svg = render(bar([{ name: 'A', values: [1, 2, 3] }], { barDir: 'bar' }))
    const label = (name: string) => Number(new RegExp(`y="([^"]+)"[^>]*>${name}<`).exec(svg)![1])
    expect(label('C1')).toBeGreaterThan(label('C3'))
  })

  it('rotates or skips crowded category labels', () => {
    const categories = Array.from({ length: 8 }, (_, i) => `A rather long category ${i}`)
    const svg = render(bar([{ name: 'A', values: [1, 2, 3, 4, 5, 6, 7, 8] }], { categories }), { width: 300 })
    expect(svg).toContain('rotate(-45')
  })

  it('draws lines with markers and breaks them at gaps', () => {
    const line = (blanks: string) =>
      chartXml(
        `<c:lineChart><c:grouping val="standard"/><c:ser><c:idx val="0"/><c:order val="0"/><c:marker><c:symbol val="square"/><c:size val="6"/></c:marker><c:val>${numRef('S!B1:B4', [1, null, 3, 4])}</c:val></c:ser><c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>${AXES}`,
        '',
      ).replace('</c:plotArea>', `</c:plotArea><c:dispBlanksAs val="${blanks}"/>`)
    const moves = (svg: string) => (elements(svg, 'path').find((el) => el.includes('stroke-linejoin="round" stroke-linecap'))!.match(/M/g) ?? []).length
    expect(moves(render(line('gap')))).toBe(2)
    expect(moves(render(line('span')))).toBe(1)
    // Three square markers.
    expect(elements(render(line('gap')), 'path').filter((el) => /d="M[^"]*h[^"]*v[^"]*Z"/.test(el))).toHaveLength(3)
  })

  it('draws pies and doughnuts with percent labels', () => {
    const pie = render(fixture('libreoffice/pie-labels.xml'), { theme: OFFICE_2007_THEME })
    expect(texts(pie)).toEqual(expect.arrayContaining(['Apples; Jan; 40; 10%', 'Apples; Jun; 95; 23%']))
    expect(fills(pie, 'path').slice(0, 6)).toEqual(['#4f81bd', '#c0504d', '#9bbb59', '#8064a2', '#4bacc6', '#f79646'])
    const doughnut = render(fixture('openpyxl/doughnut.xml'), { resolveRange: fixtureResolver })
    // Ring sectors have an inner arc.
    expect(elements(doughnut, 'path').filter((el) => (el.match(/A/g) ?? []).length === 2)).toHaveLength(6)
  })

  it('draws scatter, bubble, and radar charts', () => {
    const scatter = render(fixture('openpyxl/scatter.xml'), { resolveRange: fixtureResolver })
    expect(texts(scatter)).toEqual(expect.arrayContaining(['y1', 'y2', 'x', 'y', '10']))
    const bubble = render(fixture('openpyxl/bubble.xml'), { resolveRange: fixtureResolver })
    expect(elements(bubble, 'circle')).toHaveLength(10)
    const radar = render(fixture('openpyxl/radar.xml'), { resolveRange: fixtureResolver })
    expect(texts(radar)).toEqual(expect.arrayContaining(['Jan', 'Jun', 'Apples', 'Pears']))
  })

  it('puts a secondary value axis on the right', () => {
    const svg = render(fixture('openpyxl/combo-secondary.xml'), { resolveRange: fixtureResolver })
    const xOf = (label: string) => Number(new RegExp(`x="([^"]+)"[^>]*>${label}<`).exec(svg)![1])
    expect(xOf('35')).toBeGreaterThan(xOf('100'))
    // The category labels sit once, along the bottom.
    expect(texts(svg).filter((text) => text === 'Jan')).toHaveLength(1)
  })
})

describe('renderChartSvg: data and text', () => {
  it('uses live values from resolveRange and falls back to the cache', () => {
    const xml = fixture('excel/column-auto-title.xml')
    const cached = render(xml)
    expect(texts(cached)).toEqual(expect.arrayContaining(['Revenue', '$12,500', '-$4,200', 'Q1 2024']))
    const live: Record<string, Scalar[][]> = {
      'Sheet1!$B$1': [['Profit']],
      'Sheet1!$B$2:$B$6': [[1], [2], [3], [4], [99_999]],
    }
    const updated = render(xml, { resolveRange: (formula) => live[formula] })
    expect(texts(updated)).toEqual(expect.arrayContaining(['Profit', '$99,999', 'Q1 2024']))
    expect(texts(updated)).not.toContain('$12,500')
    const throwing = render(xml, {
      resolveRange: () => {
        throw new Error('nope')
      },
    })
    expect(texts(throwing)).toContain('$12,500')
  })

  it('colors overridden points and labels them', () => {
    const svg = render(fixture('excel/column-auto-title.xml'))
    expect(fills(svg).filter((fill) => fill === '#ed7d31')).toHaveLength(1)
    expect(svg).toContain('fill="#404040"') // Excel's data label color
  })

  it('titles single-series charts automatically unless deleted', () => {
    const single = fixture('openpyxl/single-series-labels.xml')
    const count = (svg: string) => texts(svg).filter((text) => text === 'Pears').length
    // Title plus legend entry.
    expect(count(render(single, { resolveRange: fixtureResolver }))).toBe(2)
    const deleted = single.replace('<plotArea>', '<autoTitleDeleted val="1" /><plotArea>')
    expect(count(render(deleted, { resolveRange: fixtureResolver }))).toBe(1)
    const multi = bar([{ name: 'A', values: [1] }, { name: 'B', values: [2] }]).replace('<c:chart>', '<c:chart><c:title><c:overlay val="0"/></c:title>')
    expect(texts(render(multi))).toContain('Chart Title')
  })

  it('formats General numbers compactly', () => {
    expect([0, 1, -2.5, 0.1 + 0.2, 1234567.891, 1e12, 1.5e-12].map(formatGeneral)).toEqual(['0', '1', '-2.5', '0.3', '1234567.891', '1E+12', '1.5E-12'])
  })

  it('uses theme fonts and Excel default text colors', () => {
    const svg = render(fixture('excel/column-auto-title.xml'), { theme: { ...DEFAULT_THEME, minorFont: { latin: 'Aptos', eastAsian: '', complexScript: '' } } })
    expect(svg).toMatch(/^<svg[^>]*font-family="Aptos, Calibri/)
    expect(svg).toContain('fill="#595959"')
  })
})

describe('renderChartSvg: safety', () => {
  const hostile = '<script>alert(1)</script>" onload="alert(2)\' onerror=\'x <a href="javascript:alert(3)">'

  it('escapes every piece of text from the file and the sheet', () => {
    const name = hostile.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const xml = bar([{ name, values: [1, 2] }], { categories: [name, 'ok'] }).replace('<c:chart>', `<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${name}</a:t></a:r></a:p></c:rich></c:tx></c:title>`)
    const svgs = [
      render(xml),
      render(xml, { resolveRange: (formula) => (formula.endsWith('$1') ? [[hostile]] : formula.startsWith('Sheet1!$A') ? [[hostile], ['x']] : undefined) }),
      render(xml, { formatNumber: () => hostile }),
    ]
    for (const svg of svgs) {
      assertSafeSvg(svg)
      // Markup (not text) has no scripts, links, or handlers.
      const tags = (svg.match(/<[^>]*>/g) ?? []).map((tag) => tag.replace(/"[^"]*"/g, '""'))
      expect(tags.filter((tag) => /^<(script|a|foreignObject|use|image)\b|\shref=|\son\w+=/i.test(tag))).toEqual([])
      expect(texts(svg).some((text) => text.includes('<script>'))).toBe(true)
    }
  })

  it('sanitizes fonts and ids', () => {
    const theme: Theme = { ...DEFAULT_THEME, minorFont: { latin: 'x" onload="alert(1)', eastAsian: '', complexScript: '' } }
    const svg = render(bar([{ name: 'A', values: [1] }]), { theme, fontFamily: "Evil'; background:url(http://x)", idPrefix: '"><script>' })
    assertSafeSvg(svg)
    expect(svg).not.toContain('url(http')
    const tags = (svg.match(/<[^>]*>/g) ?? []).map((tag) => tag.replace(/"[^"]*"/g, '""'))
    expect(tags.filter((tag) => /\son\w+=/.test(tag))).toEqual([])
    expect(svg).toContain('clip-path="url(#script-plot)"')
  })

  it('renders malformed and unsupported charts as a placeholder', () => {
    const broken = render('<c:chartSpace><oops')
    assertSafeSvg(broken)
    expect(texts(broken)).toEqual(['The chart could not be read'])
    const stock = render(chartXml('<c:stockChart/>'))
    expect(texts(stock).join(' ')).toContain('Stock charts are not supported yet')
  })

  it('survives absurd sizes and settings', () => {
    const xml = bar([{ name: 'A', values: [1, 2] }]).replace('<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>', '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/><c:max val="1e308"/><c:min val="-1e308"/></c:scaling><c:majorUnit val="1e-300"/>')
    for (const [width, height] of [
      [Number.NaN, 10],
      [1e9, 1e9],
      [1, 1],
      [-5, 0],
    ]) {
      const svg = render(xml, { width: width!, height: height! })
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.length).toBeLessThan(200_000)
    }
  })
})

describe('renderChartSvg: large data', () => {
  const COUNT = 100_000
  const values = Array.from({ length: COUNT }, (_, i) => Math.sin(i / 500) * 100 + (i % 7))
  const big = (type: 'line' | 'bar' | 'scatter') => {
    const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Big</c:v></c:tx>${type === 'scatter' ? '<c:xVal><c:numRef><c:f>S!A1:A100000</c:f></c:numRef></c:xVal><c:yVal>' : '<c:val>'}<c:numRef><c:f>S!B1:B100000</c:f></c:numRef>${type === 'scatter' ? '</c:yVal>' : '</c:val>'}</c:ser>`
    const element = type === 'scatter' ? 'scatterChart' : type === 'bar' ? 'barChart' : 'lineChart'
    const axes = type === 'scatter' ? AXES.replace('<c:catAx>', '<c:valAx>').replace('</c:catAx>', '</c:valAx>') : AXES
    return chartXml(`<c:${element}>${series}<c:axId val="1"/><c:axId val="2"/></c:${element}>${axes}`)
  }
  const resolveRange = (formula: string): Scalar[][] => (formula.startsWith('S!A') ? values.map((_, i) => [i]) : values.map((v) => [v]))

  it.each(['line', 'bar', 'scatter'] as const)('renders a 100k-point %s chart in bounded time and size', (type) => {
    const started = performance.now()
    const svg = render(big(type), { resolveRange })
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(3000)
    expect(svg.length).toBeLessThan(3_000_000)
    expect(svg).toContain('Big')
  })

  it('renders a 100k-point cached series parsed from XML', () => {
    const points = values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')
    const xml = chartXml(`<c:lineChart><c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:f>S!B1:B100000</c:f><c:numCache><c:ptCount val="${COUNT}"/>${points}</c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:lineChart>${AXES}`)
    const started = performance.now()
    const svg = render(xml)
    expect(performance.now() - started).toBeLessThan(5000)
    expect(svg.length).toBeLessThan(3_000_000)
  })
})
