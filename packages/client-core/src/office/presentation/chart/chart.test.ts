import { readFileSync } from 'node:fs'
import type { Element } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { LiveFormatError } from '../../live-format.js'
import { parseXml } from '../../ooxml/package.js'
import { adjustLuminance, automaticColor, DEFAULT_ACCENTS, parseCssColor } from './color.js'
import { formatGeneral, formatNumber } from './format.js'
import { parseChart, type ChartModel, type PlotModel, type SupportedChartModel } from './model.js'
import { chartTextSummary, renderChartSvg, type ChartRenderOptions } from './render.js'
import { computeScale } from './scale.js'

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}.xml`, import.meta.url), 'utf8')
}

function supported(model: ChartModel): SupportedChartModel {
  if (model.unsupported) throw new Error(`unexpected unsupported chart ${model.typeName}`)
  return model
}

function onlyPlot(xml: string): PlotModel {
  const model = supported(parseChart(xml))
  expect(model.plots).toHaveLength(1)
  return model.plots[0]!
}

const SCHEME: Record<string, string> = {
  accent1: '#4472C4',
  accent2: '#ED7D31',
  accent3: '#A5A5A5',
  accent4: '#FFC000',
  accent5: '#5B9BD5',
  accent6: '#70AD47',
  tx1: '#000000',
  bg1: '#FFFFFF',
  lt1: '#FFFFFF',
}

/** A tiny theme resolver: srgbClr and schemeClr with lumMod/lumOff. */
function resolveColor(parent: Element): string | undefined {
  const children: Element[] = []
  for (let node = parent.firstChild; node; node = node.nextSibling) if (node.nodeType === 1) children.push(node as Element)
  const color = ['srgbClr', 'schemeClr'].includes(parent.localName ?? '') ? parent : children.find((child) => child.localName === 'srgbClr' || child.localName === 'schemeClr')
  if (!color) return undefined
  const value = color.getAttribute('val') ?? ''
  const base = color.localName === 'srgbClr' ? `#${value}` : SCHEME[value]
  if (!base) return undefined
  let lumMod = 1
  let lumOff = 0
  for (let node = color.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue
    const element = node as Element
    if (element.localName === 'lumMod') lumMod = Number(element.getAttribute('val')) / 100_000
    if (element.localName === 'lumOff') lumOff = Number(element.getAttribute('val')) / 100_000
  }
  return adjustLuminance(base, lumMod, lumOff)
}

const OPTIONS: ChartRenderOptions = {
  width: 640,
  height: 420,
  resolveColor,
  accents: DEFAULT_ACCENTS,
  textColor: '#000000',
  fontFamily: 'Calibri, sans-serif',
}

/** Renders and checks the result is a well-formed SVG of the requested size. */
function render(xml: string, options: Partial<ChartRenderOptions> = {}): string {
  const svg = renderChartSvg(xml, { ...OPTIONS, ...options })
  const root = parseXml(svg).documentElement!
  expect(root.localName).toBe('svg')
  expect(root.getAttribute('viewBox')).toBe(`0 0 ${options.width ?? OPTIONS.width} ${options.height ?? OPTIONS.height}`)
  return svg
}

/** The placeholder message as it appears in SVG, apostrophe escaped. */
const PLACEHOLDER = 'couldn&#39;t be drawn'

function count(svg: string, pattern: RegExp): number {
  return svg.match(new RegExp(pattern.source, 'g'))?.length ?? 0
}

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!)
}

const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

function numbers(values: (number | null)[], formatCode = 'General'): string {
  const points = values.map((value, index) => (value === null ? '' : `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`)).join('')
  return `<c:numRef><c:f>Sheet1!$B$2</c:f><c:numCache><c:formatCode>${formatCode}</c:formatCode><c:ptCount val="${values.length}"/>${points}</c:numCache></c:numRef>`
}

function strings(values: string[]): string {
  const points = values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')
  return `<c:strRef><c:f>Sheet1!$A$2</c:f><c:strCache><c:ptCount val="${values.length}"/>${points}</c:strCache></c:strRef>`
}

function series(index: number, name: string, values: (number | null)[], categories?: string[], extra = ''): string {
  return (
    `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx>${strings([name])}</c:tx>${extra}` +
    (categories ? `<c:cat>${strings(categories)}</c:cat>` : '') +
    `<c:val>${numbers(values)}</c:val></c:ser>`
  )
}

const AXES =
  '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>' +
  '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>'

function chartXml(plot: string, { axes = AXES, chart = '<c:autoTitleDeleted val="1"/>', after = '' } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace ${C_NS}><c:chart>${chart}<c:plotArea>${plot}${axes}</c:plotArea>${after}</c:chart></c:chartSpace>`
}

function barChart(seriesXml: string, grouping = 'clustered', direction = 'col'): string {
  return chartXml(`<c:barChart><c:barDir val="${direction}"/><c:grouping val="${grouping}"/>${seriesXml}<c:axId val="1"/><c:axId val="2"/></c:barChart>`)
}

function rects(svg: string): { x: number; y: number; width: number; height: number; fill: string }[] {
  return [...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4]),
    fill: match[5]!,
  }))
}

describe('parseChart', () => {
  it('reads a clustered column chart with its title, series, categories, axes, and legend', () => {
    const model = supported(parseChart(fixture('clustered-column')))
    expect(model.title?.lines).toEqual(['Regional sales'])
    expect(model.textStyle.sizePt).toBe(18)
    const plot = model.plots[0]!
    expect(plot).toMatchObject({ type: 'bar', direction: 'col', grouping: 'clustered', gapWidth: 150, overlap: 0 })
    expect(plot.series.map((entry) => entry.name)).toEqual(['East', 'West', 'North'])
    expect(plot.series[0]!.categories?.labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(plot.series[1]!.values.values).toEqual([22.3, 28.6, 15.2, 18.9])
    expect(model.axes.map((axis) => [axis.kind, axis.position, !!axis.majorGridlines])).toEqual([
      ['cat', 'b', false],
      ['val', 'l', true],
    ])
    expect(model.legend).toMatchObject({ position: 'b', overlay: false })
  })

  it('reads stacked and percent-stacked bars with full overlap', () => {
    expect(onlyPlot(fixture('stacked-bar'))).toMatchObject({ type: 'bar', direction: 'bar', grouping: 'stacked', overlap: 100 })
    expect(onlyPlot(fixture('percent-stacked-column'))).toMatchObject({ type: 'bar', direction: 'col', grouping: 'percentStacked' })
  })

  it('reads lines with markers, smoothing, number formats, and missing points', () => {
    const plot = onlyPlot(fixture('line-markers'))
    expect(plot).toMatchObject({ type: 'line', grouping: 'standard', markers: true })
    const second = plot.series[1]!
    expect(second.marker?.symbol).toBe('square')
    expect(second.smooth).toBe(true)
    expect(second.values.formatCode).toBe('0.0')
    expect(second.values.values[7]).toBeUndefined()
    expect(second.values.values).toHaveLength(12)
  })

  it('reads pies and doughnuts with their labels', () => {
    const pie = onlyPlot(fixture('pie'))
    expect(pie).toMatchObject({ type: 'pie', varyColors: true, holeSize: 0, firstSliceAngle: 0 })
    expect(pie.dataLabels).toMatchObject({ showValue: true, numberFormat: '0%', position: 'outEnd' })
    expect(pie.series[0]!.points.get(3)?.style.fill?.kind).toBe('solid')
    const doughnut = onlyPlot(fixture('doughnut'))
    expect(doughnut).toMatchObject({ type: 'pie', holeSize: 50 })
  })

  it('reads stacked areas, scatter, bubble, and radar plots', () => {
    expect(onlyPlot(fixture('stacked-area'))).toMatchObject({ type: 'area', grouping: 'stacked' })
    const scatter = onlyPlot(fixture('scatter'))
    expect(scatter).toMatchObject({ type: 'scatter', style: 'lineMarker' })
    expect(scatter.series[0]!.xValues?.values).toEqual([0.5, 1.1, 1.9, 2.7, 3.6, 4.2])
    expect(scatter.series[0]!.style.line?.fill?.kind).toBe('none')
    const bubble = onlyPlot(fixture('bubble'))
    expect(bubble).toMatchObject({ type: 'bubble', bubbleScale: 100, sizeRepresents: 'area' })
    expect(bubble.series[0]!.bubbleSizes?.values).toEqual([10, 25, 15, 40])
    expect(onlyPlot(fixture('radar'))).toMatchObject({ type: 'radar', style: 'marker' })
  })

  it('reads PowerPoint-authored combination charts', () => {
    const model = supported(parseChart(fixture('powerpoint-combo-multilevel')))
    expect(model.style).toBe(2)
    expect(model.title?.lines).toEqual(['Revenue & margin <FY2025–26>'])
    expect(model.title?.style).toMatchObject({ sizePt: 18.62, bold: false })
    const [bars, line] = model.plots
    expect(bars).toMatchObject({ type: 'bar', gapWidth: 219, overlap: -27, axisIds: ['111', '222'] })
    expect(line).toMatchObject({ type: 'line', axisIds: ['333', '444'] })
    const categories = bars!.series[0]!.categories!
    expect(categories.labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q1', 'Q2', 'Q3', 'Q4'])
    expect(categories.outerLevels).toEqual([['FY2025', undefined, undefined, undefined, 'FY2026', undefined, undefined, undefined]])
    const labels = bars!.series[0]!.dataLabels!
    expect(labels).toMatchObject({ showValue: true, numberFormat: '"$"#,##0,"k"', position: 'outEnd' })
    expect(labels.points.get(2)?.deleted).toBe(true)
    expect(bars!.series[1]!.values.values[6]).toBeUndefined()
    const secondary = model.axes.find((axis) => axis.id === '444')!
    expect(secondary).toMatchObject({ crosses: 'max', max: 0.4, min: 0, numberFormat: { code: '0%', sourceLinked: false } })
    expect(model.axes.find((axis) => axis.id === '333')?.deleted).toBe(true)
  })

  it('reads PowerPoint-authored pies with explosion, separators, and legend edits', () => {
    const model = supported(parseChart(fixture('powerpoint-pie-exploded')))
    expect(model.autoTitleDeleted).toBe(true)
    const plot = model.plots[0]!
    expect(plot).toMatchObject({ type: 'pie', firstSliceAngle: 90 })
    expect(plot.series[0]!.points.get(2)?.explosion).toBe(12)
    expect(plot.series[0]!.dataLabels).toMatchObject({ showCategory: true, showPercent: true, separator: '\n', position: 'inEnd' })
    expect(plot.series[0]!.dataLabels!.style).toMatchObject({ bold: true, typeface: 'Segoe UI', sizePt: 11.97 })
    expect([...model.legend!.deletedEntries]).toEqual([4])
    expect(model.legend!.layout).toEqual({ x: 0.76, y: 0.3, w: 0.2, h: 0.4, target: 'outer' })
  })

  it('treats charts it cannot draw as unsupported', () => {
    const surface = chartXml('<c:surfaceChart><c:wireframe val="0"/><c:axId val="1"/><c:axId val="2"/></c:surfaceChart>')
    expect(parseChart(surface)).toEqual({ unsupported: true, typeName: 'surfaceChart' })
    const stock = chartXml('<c:stockChart><c:axId val="1"/><c:axId val="2"/></c:stockChart>')
    expect(parseChart(stock)).toEqual({ unsupported: true, typeName: 'stockChart' })
    const chartex = '<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="waterfall"/></cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>'
    expect(parseChart(chartex)).toEqual({ unsupported: true, typeName: 'waterfall' })
  })

  it('draws the supported plots of a chart that mixes in an unsupported one', () => {
    const model = supported(parseChart(chartXml(`<c:surfaceChart/><c:lineChart>${series(0, 'A', [1, 2])}<c:axId val="1"/><c:axId val="2"/></c:lineChart>`)))
    expect(model.plots.map((plot) => plot.type)).toEqual(['line'])
  })

  it('throws LiveFormatError for XML that is not a chart', () => {
    expect(() => parseChart('<c:chartSpace')).toThrow(LiveFormatError)
    expect(() => parseChart('<root/>')).toThrow(LiveFormatError)
    expect(() => parseChart(`<c:chartSpace ${C_NS}/>`)).toThrow(LiveFormatError)
  })

  it('caps series and points', () => {
    const many = Array.from({ length: 80 }, (_, index) => series(index, `S${index}`, [index])).join('')
    expect(onlyPlot(barChart(many)).series).toHaveLength(50)
    const huge = chartXml(`<c:lineChart><c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:numCache><c:ptCount val="999999999"/><c:pt idx="5"><c:v>3</c:v></c:pt><c:pt idx="99999999"><c:v>4</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:lineChart>`)
    const values = onlyPlot(huge).series[0]!.values.values
    expect(values).toHaveLength(10_000)
    expect(values[5]).toBe(3)
  })

  it('reads data through mc:AlternateContent fallbacks and ignores unknown extensions', () => {
    const xml = chartXml(
      `<c:lineChart><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="c15"><c:grouping val="stacked"/></mc:Choice><mc:Fallback><c:grouping val="percentStacked"/></mc:Fallback></mc:AlternateContent>${series(0, 'A', [1])}<c:extLst><c:ext uri="x"><foo/></c:ext></c:extLst><c:axId val="1"/><c:axId val="2"/></c:lineChart>`,
    )
    expect(onlyPlot(xml)).toMatchObject({ type: 'line', grouping: 'percentStacked' })
  })
})

describe('renderChartSvg', () => {
  const fixtures = [
    'clustered-column',
    'stacked-bar',
    'percent-stacked-column',
    'line-markers',
    'pie',
    'doughnut',
    'stacked-area',
    'scatter',
    'bubble',
    'radar',
    'powerpoint-combo-multilevel',
    'powerpoint-pie-exploded',
  ]
  it.each(fixtures)('renders %s as a well-formed SVG without a placeholder', (name) => {
    const svg = render(fixture(name))
    expect(svg).not.toContain(PLACEHOLDER)
    expect(count(svg, /<(rect|path|circle) /)).toBeGreaterThan(3)
  })

  it('draws clustered columns with Excel-like axis steps and the legend', () => {
    // The fixture's frame is 9 inches (648 pt) wide.
    const svg = render(fixture('clustered-column'), { pxPerPoint: 640 / 648 })
    const labels = texts(svg)
    expect(labels).toEqual(expect.arrayContaining(['Regional sales', 'Q1', 'Q4', 'East', 'West', 'North']))
    // Data tops out at 28.6: Excel adds headroom and steps by 5 to 35.
    expect(labels).toEqual(expect.arrayContaining(['0', '5', '30', '35']))
    expect(labels).not.toContain('40')
    const bars = rects(svg).filter((rect) => rect.width > 20)
    expect(bars).toHaveLength(12)
    expect(new Set(bars.map((bar) => bar.fill))).toEqual(new Set(['#4472C4', '#ED7D31', '#A5A5A5']))
  })

  it('stacks bars, and scales percent stacks to 100%', () => {
    const stacked = render(barChart(series(0, 'A', [2, 3], ['x', 'y']) + series(1, 'B', [4, 5]), 'stacked'))
    const [a1, a2, b1] = rects(stacked).filter((rect) => rect.height > 0 && rect.width > 20)
    expect(b1!.x).toBeCloseTo(a1!.x)
    expect(b1!.y + b1!.height).toBeCloseTo(a1!.y, 0)
    expect(a2!.x).toBeGreaterThan(a1!.x)
    const percent = render(fixture('percent-stacked-column'))
    expect(texts(percent)).toEqual(expect.arrayContaining(['0%', '20%', '100%']))
  })

  it('draws negative values below the zero line and labels them on their own side', () => {
    const xml = barChart(series(0, 'Change', [5, -5], ['up', 'down'], '').replace('</c:ser>', '<c:dLbls><c:showVal val="1"/></c:dLbls></c:ser>'))
    const svg = render(xml)
    const [up, down] = rects(svg).filter((rect) => rect.width > 20)
    expect(up!.y + up!.height).toBeCloseTo(down!.y, 0)
    const label = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*>(-?5)<\/text>/g)].map((match) => ({ y: Number(match[1]), text: match[2] }))
    const positive = label.find((entry) => entry.text === '5')!
    const negative = label.find((entry) => entry.text === '-5')!
    expect(positive.y).toBeLessThan(up!.y)
    expect(negative.y).toBeGreaterThan(down!.y + down!.height)
  })

  it('reverses axes and lays horizontal bars out bottom to top', () => {
    const horizontal = render(barChart(series(0, 'A', [1, 2], ['first', 'second']), 'clustered', 'bar'))
    const [first, second] = rects(horizontal).filter((rect) => rect.height > 10)
    expect(first!.y).toBeGreaterThan(second!.y)
    expect(second!.width).toBeGreaterThan(first!.width)
    const reversed = barChart(series(0, 'A', [1, 2], ['first', 'second'])).replace('<c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>', '<c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>')
    const [reversedFirst, reversedSecond] = rects(render(reversed)).filter((rect) => rect.width > 10 && rect.height > 0)
    expect(reversedFirst!.x).toBeGreaterThan(reversedSecond!.x)
  })

  it('breaks lines at missing points unless blanks are spanned', () => {
    const line = (blanks: string): string =>
      chartXml(`<c:lineChart><c:grouping val="standard"/>${series(0, 'A', [1, 2, null, 4, 5], undefined, '<c:marker><c:symbol val="none"/></c:marker>')}<c:axId val="1"/><c:axId val="2"/></c:lineChart>`, {
        after: `<c:dispBlanksAs val="${blanks}"/>`,
      })
    const seriesPath = (svg: string): string => /<path d="([^"]+)" fill="none" stroke-linejoin="round"/.exec(svg)![1]!
    expect(count(seriesPath(render(line('gap'))), /M/)).toBe(2)
    expect(count(seriesPath(render(line('span'))), /M/)).toBe(1)
  })

  it('turns crowded category labels and thins them out', () => {
    const categories = Array.from({ length: 40 }, (_, index) => `Category number ${index + 1}`)
    const svg = render(barChart(series(0, 'A', categories.map((_, index) => index), categories)), { width: 400, height: 300 })
    expect(svg).toContain('rotate(-45')
    const shown = texts(svg).filter((text) => text.startsWith('Category'))
    expect(shown.length).toBeGreaterThan(5)
    expect(shown.length).toBeLessThan(40)
  })

  it('colors series 7 and later with darker and lighter accents', () => {
    const many = Array.from({ length: 13 }, (_, index) => series(index, `S${index}`, [index + 1], ['x'])).join('')
    const fills = rects(render(barChart(many))).filter((rect) => rect.width > 15).map((rect) => rect.fill.toUpperCase())
    expect(fills.slice(0, 6)).toEqual([...DEFAULT_ACCENTS])
    expect(fills[6]).toBe(adjustLuminance('#4472C4', 0.6).toUpperCase())
    expect(fills[12]).toBe(adjustLuminance('#4472C4', 0.8, 0.2).toUpperCase())
  })

  it('draws pie slices with per-point colors, explosion, and percent labels', () => {
    const svg = render(fixture('powerpoint-pie-exploded'))
    const slices = [...svg.matchAll(/<path d="M[^"]+A[^"]+" fill="([^"]+)"/g)].map((match) => match[1]!.toUpperCase())
    expect(slices).toEqual(['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5'])
    const labels = texts(svg)
    expect(labels).toEqual(expect.arrayContaining(['Search', '42.7%', 'Social', '17.9%']))
    // The fifth legend entry was deleted, but its slice and label stay.
    expect(labels.filter((text) => text === 'Referral')).toHaveLength(1)
    expect(svg).toContain('font-family="&quot;Segoe UI&quot;, Calibri, sans-serif"')
  })

  it('draws doughnut rings with holes', () => {
    const svg = render(fixture('doughnut'))
    expect(texts(svg)).toEqual(expect.arrayContaining(['42', '17', '6', 'Done', 'Tasks']))
    // Ring slices are two arcs joined by lines, not wedges from the center.
    expect(count(svg, /<path d="M[^"]*A[^"]*L[^"]*A[^"]*Z"/)).toBe(3)
  })

  it('draws the secondary axis of a combination chart on the right with its own format', () => {
    const svg = render(fixture('powerpoint-combo-multilevel'))
    const labels = texts(svg)
    expect(labels).toEqual(expect.arrayContaining(['$0', '$350,000', '0%', '40%', 'FY2025', 'FY2026', '$182k']))
    expect(labels).not.toContain('$194k')
    const percent = /<text x="([\d.]+)"[^>]*>40%<\/text>/.exec(svg)!
    const dollars = /<text x="([\d.]+)"[^>]*>\$350,000<\/text>/.exec(svg)!
    expect(Number(percent[1])).toBeGreaterThan(Number(dollars[1]))
  })

  it('draws scatter markers without lines when the series line is off, and sizes bubbles by area', () => {
    const scatter = render(fixture('scatter'))
    expect(scatter).not.toContain('stroke-linejoin="round" stroke-linecap="round"')
    const bubbles = [...render(fixture('bubble')).matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((match) => Number(match[1]))
    expect(bubbles).toHaveLength(4)
    expect(Math.max(...bubbles) / Math.min(...bubbles)).toBeCloseTo(Math.sqrt(40 / 10), 1)
  })

  it('escapes chart text', () => {
    const xml = chartXml(series(0, '&lt;img src=x onerror=alert(1)&gt;', [1]).replace(/^/, '<c:barChart><c:barDir val="col"/>') + '<c:axId val="1"/><c:axId val="2"/></c:barChart>', {
      chart: '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>&lt;script&gt;alert("x")&lt;/script&gt; &amp; more</a:t></a:r></a:p></c:rich></c:tx></c:title>',
      after: '<c:legend><c:legendPos val="r"/></c:legend>',
    })
    const svg = render(xml)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('<img')
    expect(texts(svg)).toEqual(expect.arrayContaining(['&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more', '&lt;img src=x onerror=alert(1)&gt;']))
  })

  it('shows Office automatic titles for single-series charts', () => {
    expect(texts(render(fixture('pie')))).toContain('Budget')
    const twoSeries = barChart(series(0, 'A', [1]) + series(1, 'B', [2])).replace('<c:autoTitleDeleted val="1"/>', '<c:autoTitleDeleted val="0"/>')
    expect(texts(render(twoSeries))).not.toContain('A')
  })

  it('returns a placeholder for unreadable or unsupported charts instead of throwing', () => {
    expect(render('not xml at all')).toContain(`This chart ${PLACEHOLDER}`)
    expect(render(chartXml('<c:surface3DChart/>'))).toContain('Surface 3d charts can&#39;t be shown')
    expect(render('<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:series layoutId="treemap"/></cx:chartSpace>')).toContain('Treemap charts')
    expect(renderChartSvg(fixture('clustered-column'), { ...OPTIONS, width: Number.NaN, height: -5 })).toContain('viewBox="0 0 1 1"')
  })

  it('survives broken resolvers and empty data', () => {
    const svg = render(fixture('powerpoint-combo-multilevel'), {
      resolveColor: () => {
        throw new Error('theme exploded')
      },
      accents: [],
    })
    expect(svg).not.toContain(PLACEHOLDER)
    expect(render(barChart('<c:ser><c:idx val="0"/><c:order val="0"/></c:ser>'))).not.toContain(PLACEHOLDER)
    expect(render(chartXml('<c:pieChart><c:ser><c:idx val="0"/><c:order val="0"/><c:val>' + numbers([0, 0]) + '</c:val></c:ser></c:pieChart>', { axes: '' }))).not.toContain(PLACEHOLDER)
  })

  it('scales text with pxPerPoint', () => {
    const small = /font-size="([\d.]+)"/.exec(render(fixture('clustered-column'), { pxPerPoint: 0.5 }))!
    expect(Number(small[1])).toBeCloseTo(9)
  })
})

describe('chartTextSummary', () => {
  it('lists the title and each series with its categories and formatted values', () => {
    expect(chartTextSummary(fixture('clustered-column'))).toBe(
      ['Chart: Regional sales', 'East: Q1 19.2, Q2 21.4, Q3 16.7, Q4 25', 'West: Q1 22.3, Q2 28.6, Q3 15.2, Q4 18.9', 'North: Q1 12, Q2 14.5, Q3 18.1, Q4 21.3'].join('\n'),
    )
    expect(chartTextSummary(fixture('pie'))).toContain('Budget: Rent 35%, Food 25%')
    expect(chartTextSummary(fixture('scatter'))).toContain('Trial A: (0.5, 1.2), (1.1, 2.3)')
  })

  it('names charts it cannot read', () => {
    expect(chartTextSummary('<nope')).toBe('[Chart]')
    expect(chartTextSummary(chartXml('<c:stockChart/>'))).toBe('[Stock chart]')
  })
})

describe('formatNumber', () => {
  it.each([
    [1234.5678, 'General', '1234.5678'],
    [0.1 + 0.2, 'General', '0.3'],
    [123456789012, 'General', '1.23E+11'],
    [1234.5, '0', '1235'],
    [1234.56, '0.0', '1234.6'],
    [0.256, '0%', '26%'],
    [0.2567, '0.00%', '25.67%'],
    [1234567.8, '#,##0', '1,234,568'],
    [1234567.8, '#,##0.00', '1,234,567.80'],
    [1234.5, '"$"#,##0', '$1,235'],
    [1234.5, '$#,##0.00', '$1,234.50'],
    [-1234.5, '$#,##0;($#,##0)', '($1,235)'],
    [-3, '0.0', '-3.0'],
    [0, '0;-0;"zero"', 'zero'],
    [1500, '[$€-407]#,##0', '€1,500'],
    [288400, '"$"#,##0,"k"', '$288k'],
    [12345, '0.00E+00', '1.23E+04'],
    [0.5, '#.##', '.5'],
    [45658, 'm/d/yyyy', '1/1/2025'],
    [45688, 'mmm-yy', 'Jan-25'],
    [45689.75, 'h:mm AM/PM', '6:00 PM'],
    [45689, 'dddd d mmmm', 'Saturday 1 February'],
  ])('formats %s with %s as %s', (value, code, expected) => {
    expect(formatNumber(value, code)).toBe(expected)
  })

  it('counts from 1904 when the workbook does', () => {
    expect(formatNumber(0, 'yyyy-mm-dd', { date1904: true })).toBe('1904-01-01')
  })

  it('keeps General compact', () => {
    expect(formatGeneral(1e-12)).toBe('1.00E-12')
    expect(formatGeneral(-2.5)).toBe('-2.5')
  })
})

describe('computeScale', () => {
  it('starts at zero, adds headroom, and picks 1-2-5 steps like Excel', () => {
    expect(computeScale({ dataMin: 12, dataMax: 28.6, maxIntervals: 8 })).toMatchObject({ min: 0, max: 35, majorUnit: 5 })
    expect(computeScale({ dataMin: -19, dataMax: 87, maxIntervals: 8 })).toMatchObject({ min: -40, max: 100, majorUnit: 20 })
    expect(computeScale({ dataMin: 0, dataMax: 1, maxIntervals: 10, exact: true })).toMatchObject({ min: 0, max: 1, majorUnit: 0.1 })
  })

  it('leaves zero when the data sits far above it', () => {
    const scale = computeScale({ dataMin: 950, dataMax: 1000, maxIntervals: 6 })
    expect(scale.min).toBeGreaterThan(0)
    expect(scale.max).toBeGreaterThanOrEqual(1000)
  })

  it('honors fixed bounds and units, and bounds the tick count', () => {
    expect(computeScale({ dataMin: 0, dataMax: 10, maxIntervals: 5, min: 2, max: 8, majorUnit: 3 }).ticks).toEqual([2, 5, 8])
    expect(computeScale({ dataMin: 0, dataMax: 1e9, maxIntervals: 5, majorUnit: 1e-9 }).ticks.length).toBeLessThanOrEqual(1001)
  })

  it('steps by powers of the base on log axes', () => {
    expect(computeScale({ dataMin: 3, dataMax: 64000, maxIntervals: 10, logBase: 10 }).ticks).toEqual([1, 10, 100, 1000, 10_000, 100_000])
  })
})

describe('colors', () => {
  it('cycles accents with Office luminance variations', () => {
    expect(automaticColor(DEFAULT_ACCENTS, 0)).toBe('#4472C4')
    expect(automaticColor(DEFAULT_ACCENTS, 6)).toBe(adjustLuminance('#4472C4', 0.6))
    expect(automaticColor([], 1)).toBe('#ED7D31')
    expect(automaticColor(['var(--accent)'], 3)).toBe('var(--accent)')
  })

  it('parses CSS colors it can adjust', () => {
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseCssColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(adjustLuminance('#000000', 0.65, 0.35)).toBe('#595959')
    expect(parseCssColor('tomato')).toBeUndefined()
  })
})
