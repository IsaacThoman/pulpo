import { describe, expect, it } from 'vitest'
import { MAX_CHART_POINTS } from './model.js'
import { parseChart } from './parse.js'
import { AXES, C, chartXml, fixture, numRef } from './test-data.js'

describe('parseChart: openpyxl fixtures', () => {
  it('reads a clustered column chart', () => {
    const model = parseChart(fixture('openpyxl/bar-clustered.xml'))
    expect(model.unsupported).toBe(false)
    expect(model.title?.paragraphs[0]?.[0]?.text).toBe('Fruit sales')
    const [group] = model.groups
    expect(group).toMatchObject({ type: 'bar', barDirection: 'col', grouping: 'clustered', gapWidth: 150, overlap: 0, axisIds: [10, 100] })
    expect(group!.series.map((s) => s.nameFormula)).toEqual(["'Sheet1'!B1", "'Sheet1'!C1", "'Sheet1'!D1"])
    expect(group!.series[0]!.values).toEqual({ formula: "'Sheet1'!$B$2:$B$7", kind: 'number', count: 0, values: [] })
    expect(model.axes.map((axis) => [axis.id, axis.kind, axis.majorTickMark])).toEqual([
      [10, 'category', 'none'],
      [100, 'value', 'none'],
    ])
    expect(model.axes[1]!.majorGridlines).toEqual({})
    expect(model.axes[0]!.title?.paragraphs[0]?.[0]?.text).toBe('Month')
    expect(model.legend).toMatchObject({ position: 'r', overlay: false })
    expect(model.displayBlanksAs).toBe('gap')
  })

  it.each([
    ['bar-stacked-horizontal', { type: 'bar', barDirection: 'bar', grouping: 'stacked', overlap: 100 }],
    ['bar-percent-stacked', { type: 'bar', grouping: 'percentStacked', overlap: 100 }],
    ['line-markers', { type: 'line', grouping: 'standard' }],
    ['area-stacked', { type: 'area', grouping: 'stacked' }],
    ['pie-labels', { type: 'pie', varyColors: true, firstSliceAngle: 0 }],
    ['doughnut', { type: 'doughnut', holeSize: 50 }],
    ['scatter', { type: 'scatter' }],
    ['bubble', { type: 'bubble', bubbleScale: 100 }],
    ['radar', { type: 'radar', radarStyle: 'marker' }],
    ['bar-3d', { type: 'bar', is3D: true }],
  ])('reads %s', (name, expected) => {
    const model = parseChart(fixture(`openpyxl/${name}.xml`))
    expect(model.unsupported).toBe(false)
    expect(model.groups[0]).toMatchObject(expected)
  })

  it('reads line markers and smoothing', () => {
    const [group] = parseChart(fixture('openpyxl/line-markers.xml')).groups
    expect(group!.series.map((s) => [s.marker?.symbol, s.marker?.size, s.smooth ?? false])).toEqual([
      ['circle', 7, false],
      ['triangle', 7, true],
      ['x', 7, false],
    ])
  })

  it('reads scatter x/y values and line formatting', () => {
    const [group] = parseChart(fixture('openpyxl/scatter.xml')).groups
    const [first, second] = group!.series
    expect(first!.xValues?.formula).toBe("'Data'!$A$2:$A$21")
    expect(first!.values?.formula).toBe("'Data'!$B$2:$B$21")
    expect(first!.format.line?.fill).toEqual({ type: 'none' })
    expect(second!.format.line?.fill).toBeUndefined()
    expect(parseChart(fixture('openpyxl/scatter.xml')).style).toBe(13)
  })

  it('reads bubble sizes', () => {
    const [group] = parseChart(fixture('openpyxl/bubble.xml')).groups
    expect(group!.series[0]!.bubbleSizes?.formula).toBe("'Data'!$D$2:$D$11")
    expect(group!.series[0]!.name).toBe('Bubbles A')
  })

  it('reads combo charts with a secondary axis', () => {
    const model = parseChart(fixture('openpyxl/combo-secondary.xml'))
    expect(model.groups.map((g) => [g.type, g.axisIds])).toEqual([
      ['bar', [10, 100]],
      ['line', [10, 200]],
    ])
    expect(model.axes.find((axis) => axis.id === 200)).toMatchObject({ kind: 'value', crosses: 'max' })
  })

  it('reads group data labels', () => {
    const model = parseChart(fixture('openpyxl/pie-labels.xml'))
    expect(model.groups[0]!.dataLabels).toMatchObject({ showPercent: true, showValue: false, deleted: false })
    // Series without their own labels inherit the group's.
    expect(model.groups[0]!.series[0]!.dataLabels).toBeUndefined()
  })
})

describe('parseChart: cached data', () => {
  it('reads string and number caches from LibreOffice output', () => {
    const [group] = parseChart(fixture('libreoffice/bar-clustered.xml')).groups
    const series = group!.series[0]!
    expect(series.name).toBe('Apples')
    expect(series.nameFormula).toBe('Sheet1!B1')
    expect(series.categories).toMatchObject({ kind: 'string', count: 6, values: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] })
    expect(series.values).toMatchObject({ kind: 'number', formatCode: 'General', count: 6, values: [40, 55, 70, 60, 85, 95] })
  })

  it('reads an Excel 2016-style chart', () => {
    const model = parseChart(fixture('excel/column-auto-title.xml'))
    // mc:AlternateContent: the c14 choice is not understood, so the fallback c:style applies.
    expect(model.style).toBe(2)
    expect(model.roundedCorners).toBe(false)
    expect(model.title).toMatchObject({ paragraphs: [], overlay: false })
    expect(model.title?.style.size).toBe(14)
    expect(model.title?.style.color).toEqual({ kind: 'scheme', value: 'tx1', modifiers: [{ name: 'lumMod', value: 65000 }, { name: 'lumOff', value: 35000 }] })
    expect(model.autoTitleDeleted).toBe(false)
    const [group] = model.groups
    expect(group).toMatchObject({ gapWidth: 219, overlap: -27, varyColors: false })
    const series = group!.series[0]!
    expect(series.values?.formatCode).toBe('"$"#,##0')
    expect(series.values?.values).toEqual([12500, 15800, 21300, -4200, 18750])
    expect(series.points).toHaveLength(1)
    expect(series.points[0]).toMatchObject({ index: 2, format: { fill: { type: 'solid', color: { kind: 'scheme', value: 'accent2' } } } })
    expect(series.dataLabels).toMatchObject({ showValue: true, position: 'outEnd' })
    expect(series.dataLabels?.style.size).toBe(9)
    const [cat, val] = model.axes
    expect(cat).toMatchObject({ kind: 'category', tickLabelPosition: 'low', crosses: 'autoZero' })
    // rot="-60000000" means automatic, not a rotation.
    expect(cat!.textRotation).toBeUndefined()
    expect(val!.numberFormat).toEqual({ formatCode: '"$"#,##0', sourceLinked: true })
    expect(val!.format.line?.fill).toEqual({ type: 'none' })
    expect(model.chartFormat.fill).toEqual({ type: 'solid', color: { kind: 'scheme', value: 'bg1', modifiers: [] } })
  })

  it('reads multi-level category caches and literals', () => {
    const model = parseChart(
      chartXml(
        `<c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Literal name</c:v></c:tx>
        <c:cat><c:multiLvlStrRef><c:f>Sheet1!$A$2:$B$5</c:f><c:multiLvlStrCache><c:ptCount val="4"/>
          <c:lvl><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt><c:pt idx="2"><c:v>Q1</c:v></c:pt><c:pt idx="3"><c:v>Q2</c:v></c:pt></c:lvl>
          <c:lvl><c:pt idx="0"><c:v>2024</c:v></c:pt><c:pt idx="2"><c:v>2025</c:v></c:pt></c:lvl>
        </c:multiLvlStrCache></c:multiLvlStrRef></c:cat>
        <c:val><c:numLit><c:formatCode>0.0</c:formatCode><c:ptCount val="4"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="3"><c:v>4</c:v></c:pt></c:numLit></c:val></c:ser>
        <c:axId val="1"/><c:axId val="2"/></c:barChart>${AXES}`,
      ),
    )
    const series = model.groups[0]!.series[0]!
    expect(series.name).toBe('Literal name')
    expect(series.categories?.levels).toEqual([
      ['Q1', 'Q2', 'Q1', 'Q2'],
      ['2024', null, '2025', null],
    ])
    expect(series.values).toEqual({ kind: 'number', count: 4, values: [1, null, null, 4], formatCode: '0.0' })
  })

  it('reads axis scaling, crossings, legend entries, and blanks', () => {
    const model = parseChart(
      chartXml(
        `<c:lineChart><c:grouping val="standard"/><c:marker val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:val>${numRef('S!A1:A3', [1, null, 3])}</c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:lineChart>
        <c:dateAx><c:axId val="1"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:numFmt formatCode="mmm yy" sourceLinked="0"/><c:tickLblPos val="none"/><c:crossAx val="2"/><c:crossesAt val="5"/><c:baseTimeUnit val="months"/></c:dateAx>
        <c:valAx><c:axId val="2"/><c:scaling><c:logBase val="10"/><c:orientation val="minMax"/><c:max val="1000"/><c:min val="1"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/><c:crosses val="max"/><c:majorUnit val="10"/>
        <c:dispUnits><c:builtInUnit val="thousands"/></c:dispUnits></c:valAx>`,
        '<c:autoTitleDeleted val="1"/>',
      ).replace('</c:plotArea>', '</c:plotArea><c:legend><c:legendPos val="b"/><c:legendEntry><c:idx val="0"/><c:delete val="1"/></c:legendEntry><c:overlay val="1"/></c:legend><c:dispBlanksAs val="span"/>'),
    )
    const [date, value] = model.axes
    expect(date).toMatchObject({ kind: 'date', reversed: true, deleted: true, tickLabelPosition: 'none', crossesAt: 5, baseTimeUnit: 'months', numberFormat: { formatCode: 'mmm yy', sourceLinked: false } })
    expect(value).toMatchObject({ logBase: 10, min: 1, max: 1000, crosses: 'max', majorUnit: 10, displayUnit: 1000 })
    expect(model.legend).toMatchObject({ position: 'b', overlay: true, deletedEntries: [0] })
    expect(model.displayBlanksAs).toBe('span')
    expect(model.autoTitleDeleted).toBe(true)
    expect(model.groups[0]!.showMarkers).toBe(true)
  })

  it('reads strict OOXML namespaces', () => {
    const strict = chartXml(`<c:pieChart><c:ser><c:idx val="0"/><c:order val="0"/><c:val>${numRef('A1:A2', [1, 2])}</c:val></c:ser></c:pieChart>`)
      .replace('http://schemas.openxmlformats.org/drawingml/2006/chart', 'http://purl.oclc.org/ooxml/drawingml/chart')
      .replace('http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main')
    expect(parseChart(strict).groups[0]?.type).toBe('pie')
  })
})

describe('parseChart: unsupported and hostile input', () => {
  it.each([
    ['stockChart', 'Stock'],
    ['surfaceChart', 'Surface'],
    ['surface3DChart', 'Surface'],
    ['ofPieChart', 'Pie of pie'],
  ])('flags %s as unsupported', (element, reason) => {
    const model = parseChart(chartXml(`<c:${element}><c:ser><c:idx val="0"/><c:order val="0"/></c:ser></c:${element}>`))
    expect(model.unsupported).toBe(true)
    expect(model.unsupportedReason).toContain(reason)
    expect(model.error).toBeUndefined()
  })

  it('flags chartex charts as unsupported', () => {
    const model = parseChart('<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart/></cx:chartSpace>')
    expect(model).toMatchObject({ unsupported: true, unsupportedReason: 'This chart type is not supported yet' })
  })

  it.each([
    ['', 'empty'],
    ['<c:chartSpace', 'truncated'],
    ['not xml at all', 'text'],
    ['<?xml version="1.0"?><root/>', 'another document'],
    [`<c:chartSpace ${C}><c:chart><c:plotArea/></c:chart></c:chartSpace>`, 'no chart types'],
    [`<c:chartSpace ${C}/>`, 'no chart element'],
  ])('returns an unsupported model for %j (%s) instead of throwing', (xml) => {
    const model = parseChart(xml)
    expect(model.unsupported).toBe(true)
  })

  it('reports XML errors', () => {
    const model = parseChart('<c:chartSpace><unclosed></c:chartSpace>')
    expect(model.error).toBeTruthy()
  })

  it('caps point counts and ignores out-of-range indexes', () => {
    const model = parseChart(
      chartXml(
        `<c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:f>A1</c:f><c:numCache><c:ptCount val="1000000000000"/><c:pt idx="-1"><c:v>1</c:v></c:pt><c:pt idx="2"><c:v>NaN</c:v></c:pt><c:pt idx="3"><c:v>Infinity</c:v></c:pt><c:pt idx="4"><c:v>7</c:v></c:pt><c:pt idx="99999999999"><c:v>5</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart>`,
      ),
    )
    const values = model.groups[0]!.series[0]!.values!
    expect(values.count).toBe(MAX_CHART_POINTS)
    expect(values.values[2]).toBeNull()
    expect(values.values[3]).toBeNull()
    expect(values.values[4]).toBe(7)
  })

  it('clamps out-of-range settings', () => {
    const model = parseChart(
      chartXml(
        `<c:doughnutChart><c:varyColors val="1"/><c:firstSliceAng val="-450"/><c:holeSize val="999"/><c:ser><c:idx val="0"/><c:order val="0"/><c:explosion val="100000"/><c:marker><c:symbol val="bogus"/><c:size val="9999"/></c:marker></c:ser></c:doughnutChart>`,
      ),
    )
    const group = model.groups[0]!
    expect(group.holeSize).toBe(90)
    expect(group.firstSliceAngle).toBe(270)
    expect(group.series[0]!.explosion).toBe(400)
    expect(group.series[0]!.marker).toEqual({ size: 72, format: {} })
  })
})
