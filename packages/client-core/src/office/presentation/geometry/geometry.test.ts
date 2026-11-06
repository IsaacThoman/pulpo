import { describe, expect, it } from 'vitest'
import { parseXml } from '../../ooxml/package.js'
import { builtinGuides, evaluateGuide, parseGuide } from './formula.js'
import {
  adjustDefaults,
  CUSTOM_GEOMETRY_LIMITS,
  customGeometry,
  PRESET_SHAPE_GALLERY,
  PRESET_SHAPE_NAMES,
  presetGeometry,
  type GeometryElement,
  type GeometryResult,
} from './index.js'

const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
/** SVG path data as this module writes it: command letters, each followed by plain numbers. */
const PATH_DATA = /^(?:[MLCQAZ](?:-?\d+(?:\.\d+)?(?: -?\d+(?:\.\d+)?)*)?)+$/

function numbers(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

/** The last point a path reaches. */
function endPoint(d: string): [number, number] {
  const values = numbers(d)
  return [values.at(-2) ?? NaN, values.at(-1) ?? NaN]
}

function commandCount(d: string): number {
  return (d.match(/[MLCQAZ]/g) ?? []).length
}

function geometry(name: string, w: number, h: number, adjust?: Record<string, number>): GeometryResult {
  const result = presetGeometry(name, w, h, adjust)
  if (!result) throw new Error(`no preset ${name}`)
  return result
}

function custGeom(body: string): GeometryElement {
  const document = parseXml(`<a:custGeom xmlns:a="${DRAWINGML_NS}">${body}</a:custGeom>`)
  if (!document.documentElement) throw new Error('no root')
  return document.documentElement
}

function expectFinite(result: GeometryResult): void {
  const { textRect } = result
  for (const value of [textRect.l, textRect.t, textRect.r, textRect.b]) expect(Number.isFinite(value)).toBe(true)
  for (const cxn of result.connections) expect([cxn.x, cxn.y, cxn.ang].every(Number.isFinite)).toBe(true)
  for (const handle of result.handles) {
    for (const value of Object.values(handle)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
  }
  for (const path of result.paths) {
    expect(path.d).toMatch(PATH_DATA)
    expect(numbers(path.d).every(Number.isFinite)).toBe(true)
  }
}

describe('formula', () => {
  const values = builtinGuides(200, 100)
  const evaluate = (formula: string) => {
    const guide = parseGuide('x', formula)
    if (!guide) throw new Error(`bad formula ${formula}`)
    return evaluateGuide(guide, values)
  }

  it('defines the builtin guides', () => {
    expect(values.get('ss')).toBe(100)
    expect(values.get('ls')).toBe(200)
    expect(values.get('hc')).toBe(100)
    expect(values.get('vc')).toBe(50)
    expect(values.get('wd32')).toBe(6.25)
    expect(values.get('hd6')).toBeCloseTo(16.667, 3)
    expect(values.get('ssd8')).toBe(12.5)
    expect(values.get('3cd4')).toBe(16200000)
    expect(values.get('7cd8')).toBe(18900000)
  })

  it('implements every operator', () => {
    expect(evaluate('*/ w 3 4')).toBe(150)
    expect(evaluate('+- w h 50')).toBe(250)
    expect(evaluate('+/ w h 3')).toBe(100)
    expect(evaluate('?: 1 w h')).toBe(200)
    expect(evaluate('?: 0 w h')).toBe(100)
    expect(evaluate('abs -7')).toBe(7)
    expect(evaluate('at2 0 10')).toBeCloseTo(5400000)
    expect(evaluate('cat2 10 3 4')).toBeCloseTo(6)
    expect(evaluate('cos 10 cd2')).toBeCloseTo(-10)
    expect(evaluate('max 3 9')).toBe(9)
    expect(evaluate('min 3 9')).toBe(3)
    expect(evaluate('mod 2 3 6')).toBe(7)
    expect(evaluate('pin 0 -5 10')).toBe(0)
    expect(evaluate('pin 0 15 10')).toBe(10)
    expect(evaluate('pin 0 5 10')).toBe(5)
    expect(evaluate('sat2 10 3 4')).toBeCloseTo(8)
    expect(evaluate('sin 10 cd4')).toBeCloseTo(10)
    expect(evaluate('sqrt 49')).toBe(7)
    expect(evaluate('tan 10 2700000')).toBeCloseTo(10)
    expect(evaluate('val -42')).toBe(-42)
  })

  it('degrades division by zero, unknown names, and overflow to 0', () => {
    expect(evaluate('*/ w 1 0')).toBe(0)
    expect(evaluate('val nope')).toBe(0)
    expect(evaluate('*/ 1e308 10 1')).toBe(0)
    expect(evaluate('sqrt -1')).toBe(0)
    expect(parseGuide('x', 'eval w')).toBeUndefined()
    expect(parseGuide('x', '')).toBeUndefined()
  })
})

describe('presetGeometry', () => {
  it('knows all ECMA-376 preset shapes', () => {
    expect(PRESET_SHAPE_NAMES.length).toBe(187)
    expect(PRESET_SHAPE_NAMES).toContain('rect')
    expect(PRESET_SHAPE_NAMES).toContain('actionButtonHome')
  })

  it.each([
    [100, 50],
    [50, 100],
    [914400, 457200],
    [1, 1],
    [0.01, 3],
    [0, 0],
    [0, 40],
  ])('draws every preset with finite numbers at %s x %s', (w, h) => {
    for (const name of PRESET_SHAPE_NAMES) {
      const result = geometry(name, w, h)
      expect(result.paths.length, name).toBeGreaterThan(0)
      expect(result.paths.some((path) => path.d.startsWith('M')), name).toBe(true)
      expectFinite(result)
    }
  })

  it('stays finite at extreme adjust values', () => {
    for (const name of PRESET_SHAPE_NAMES) {
      for (const extreme of [-2147483647, 0, 2147483647]) {
        const adjust = Object.fromEntries(Object.keys(adjustDefaults(name)).map((key) => [key, extreme]))
        expectFinite(geometry(name, 120, 80, adjust))
      }
    }
  })

  it('returns undefined for unknown names, including prototype keys', () => {
    for (const name of ['notAShape', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(presetGeometry(name, 10, 10)).toBeUndefined()
      expect(adjustDefaults(name)).toEqual({})
    }
  })

  it('draws rect', () => {
    const result = geometry('rect', 100, 50)
    expect(result.paths).toEqual([{ d: 'M0 0L100 0L100 50L0 50Z', fill: 'norm', stroke: true, extrusionOk: true }])
    expect(result.textRect).toEqual({ l: 0, t: 0, r: 100, b: 50 })
    expect(result.connections).toEqual([
      { x: 50, y: 0, ang: 16200000 },
      { x: 0, y: 25, ang: 10800000 },
      { x: 50, y: 50, ang: 5400000 },
      { x: 100, y: 25, ang: 0 },
    ])
    expect(result.handles).toEqual([])
  })

  it('draws roundRect with the default corner of 16667 of the short side', () => {
    expect(adjustDefaults('roundRect')).toEqual({ adj: 16667 })
    const result = geometry('roundRect', 100, 50)
    const radius = (50 * 16667) / 100000
    const [d = ''] = result.paths.map((path) => path.d)
    const [startX, startY, rx, ry, , , , x1, y1] = numbers(d)
    expect([startX, startY]).toEqual([0, expect.closeTo(radius, 2)])
    expect([rx, ry]).toEqual([expect.closeTo(radius, 2), expect.closeTo(radius, 2)])
    // The first corner arc ends on the top edge, one radius in.
    expect([x1, y1]).toEqual([expect.closeTo(radius, 2), 0])
    expect(commandCount(d)).toBe(9)
    expect(result.handles).toEqual([
      { kind: 'xy', x: expect.closeTo(radius, 6), y: 0, refX: 'adj', minX: 0, maxX: 50000 },
    ])
    // The text inset is r * (1 - cos 45°), which the spec writes as 29289 / 100000.
    expect(result.textRect.l).toBeCloseTo((radius * 29289) / 100000, 6)
  })

  it('draws ellipse as four quarter arcs', () => {
    expect(geometry('ellipse', 100, 50).paths[0]?.d).toBe(
      'M0 25A50 25 0 0 1 50 0A50 25 0 0 1 100 25A50 25 0 0 1 50 50A50 25 0 0 1 0 25Z',
    )
  })

  it('draws triangle and moves its apex with adj', () => {
    expect(geometry('triangle', 100, 50).paths[0]?.d).toBe('M0 50L50 0L100 50Z')
    expect(geometry('triangle', 100, 50, { adj: 25000 }).paths[0]?.d).toBe('M0 50L25 0L100 50Z')
    expect(geometry('triangle', 100, 50).textRect).toEqual({ l: 25, t: 25, r: 75, b: 50 })
  })

  it('draws rightArrow', () => {
    const result = geometry('rightArrow', 100, 50)
    expect(result.paths[0]?.d).toBe('M0 12.5L75 12.5L75 0L100 25L75 50L75 37.5L0 37.5Z')
    expect(geometry('rightArrow', 100, 50, { adj1: 20000, adj2: 100000 }).paths[0]?.d).toBe(
      'M0 20L50 20L50 0L100 25L50 50L50 30L0 30Z',
    )
  })

  it('draws star5', () => {
    expect(geometry('star5', 100, 50).paths[0]?.d).toBe(
      'M0 19.098L38.197 19.098L50 0L61.803 19.098L100 19.098L69.098 30.902L80.902 50L50 38.196L19.098 50L30.902 30.902Z',
    )
  })

  it('draws wedgeRectCallout with its tail at the adjust position', () => {
    const result = geometry('wedgeRectCallout', 100, 50)
    expect(numbers(result.paths[0]?.d ?? '')).toEqual(expect.arrayContaining([29.167, 56.25]))
    expect(result.handles[0]).toMatchObject({ kind: 'xy', x: 29.167, y: 56.25, refX: 'adj1', refY: 'adj2' })
    const moved = geometry('wedgeRectCallout', 100, 50, { adj1: 30000, adj2: -80000 })
    expect(moved.handles[0]).toMatchObject({ x: 80, y: -15 })
    expect(moved.paths[0]?.d).toContain('L80 -15')
  })

  it('draws chevron', () => {
    expect(geometry('chevron', 100, 50).paths[0]?.d).toBe('M0 0L75 0L100 25L75 50L0 50L25 25Z')
  })

  it('draws arc with a stroke-only outline and a filled pie', () => {
    const [pie, outline] = geometry('arc', 100, 50).paths
    expect(pie).toEqual({ d: 'M50 0A50 25 0 0 1 100 25L50 25Z', fill: 'norm', stroke: false, extrusionOk: false })
    expect(outline).toEqual({ d: 'M50 0A50 25 0 0 1 100 25', fill: 'none', stroke: true, extrusionOk: true })
  })

  it('ends arcs where the shape guides put them, for non-circular ellipses', () => {
    // DrawingML arc angles are visual angles; the arc preset's own guides compute both ends that way.
    for (const [adj1, adj2] of [
      [2700000, 9000000],
      [1000000, 20000000],
      [18000000, 3000000],
      [12000000, 11000000],
    ]) {
      for (const [w, h] of [
        [300, 70],
        [40, 200],
      ]) {
        const result = geometry('arc', w ?? 0, h ?? 0, { adj1: adj1 ?? 0, adj2: adj2 ?? 0 })
        const [start, end] = result.handles
        const d = result.paths[1]?.d ?? ''
        const [startX, startY] = numbers(d)
        expect(startX).toBeCloseTo(start?.x ?? NaN, 2)
        expect(startY).toBeCloseTo(start?.y ?? NaN, 2)
        const [endX, endY] = endPoint(d)
        expect(endX).toBeCloseTo(end?.x ?? NaN, 2)
        expect(endY).toBeCloseTo(end?.y ?? NaN, 2)
      }
    }
  })

  it('draws blockArc as an outer and an inner arc', () => {
    expect(geometry('blockArc', 100, 50).paths[0]?.d).toBe('M0 25A50 25 0 0 1 100 25L87.5 25A37.5 12.5 0 0 0 12.5 25Z')
    // The thickest band flattens the inner ellipse to a segment, which still ends opposite its start.
    expect(geometry('blockArc', 100, 50, { adj3: 50000 }).paths[0]?.d).toBe(
      'M0 25A50 25 0 0 1 100 25L75 25A25 0 0 0 0 25 25Z',
    )
  })

  it('draws can with a lightened lid', () => {
    const [body, lid, outline] = geometry('can', 100, 50).paths
    expect(body).toMatchObject({ d: 'M0 6.25A50 6.25 0 0 0 100 6.25L100 43.75A50 6.25 0 0 1 0 43.75Z', stroke: false })
    expect(lid).toMatchObject({ d: 'M0 6.25A50 6.25 0 0 1 100 6.25A50 6.25 0 0 1 0 6.25Z', fill: 'lighten' })
    expect(outline).toMatchObject({ fill: 'none', stroke: true })
  })

  it('draws cube with shaded faces', () => {
    const paths = geometry('cube', 100, 50).paths
    expect(paths.map((path) => [path.fill, path.d])).toEqual([
      ['norm', 'M0 12.5L87.5 12.5L87.5 50L0 50Z'],
      ['darkenLess', 'M87.5 12.5L100 0L100 37.5L87.5 50Z'],
      ['lightenLess', 'M0 12.5L12.5 0L100 0L87.5 12.5Z'],
      ['none', 'M0 12.5L12.5 0L100 0L100 37.5L87.5 50L0 50ZM0 12.5L87.5 12.5L100 0M87.5 12.5L87.5 50'],
    ])
  })

  it('draws donut with a reversed inner ring', () => {
    expect(geometry('donut', 100, 50).paths[0]?.d).toBe(
      'M0 25A50 25 0 0 1 50 0A50 25 0 0 1 100 25A50 25 0 0 1 50 50A50 25 0 0 1 0 25Z' +
        'M12.5 25A37.5 12.5 0 0 0 50 37.5A37.5 12.5 0 0 0 87.5 25A37.5 12.5 0 0 0 50 12.5A37.5 12.5 0 0 0 12.5 25Z',
    )
  })

  it('applies only finite overrides of the shape’s own adjust values', () => {
    const plain = geometry('rect', 100, 50)
    expect(geometry('rect', 100, 50, { w: 5, h: 5, r: 1 })).toEqual(plain)
    const triangle = geometry('triangle', 100, 50)
    expect(geometry('triangle', 100, 50, { adj: NaN })).toEqual(triangle)
    expect(geometry('triangle', 100, 50, { adj: Infinity })).toEqual(triangle)
    expect(geometry('triangle', 100, 50, { other: 0 })).toEqual(triangle)
  })

  it('treats non-finite and negative sizes as 0', () => {
    expect(geometry('rect', NaN, Infinity).paths[0]?.d).toBe('M0 0L0 0L0 0L0 0Z')
    expect(geometry('rect', -10, 5).paths[0]?.d).toBe('M0 0L0 0L0 5L0 5Z')
  })

  it('lists every adjust value with its default', () => {
    expect(adjustDefaults('star5')).toEqual({ adj: 19098, hf: 105146, vf: 110557 })
    expect(adjustDefaults('rect')).toEqual({})
  })
})

describe('PRESET_SHAPE_GALLERY', () => {
  it('only lists known presets, each once', () => {
    const listed = PRESET_SHAPE_GALLERY.flatMap((category) => category.shapes)
    for (const name of listed) expect(PRESET_SHAPE_NAMES).toContain(name)
    expect(new Set(listed).size).toBe(listed.length)
    expect(PRESET_SHAPE_GALLERY.map((category) => category.id)).toEqual([
      'lines',
      'rectangles',
      'basicShapes',
      'blockArrows',
      'equationShapes',
      'flowchart',
      'starsAndBanners',
      'callouts',
      'actionButtons',
    ])
  })
})

describe('customGeometry', () => {
  it('parses guides, handles, connections, the text rect, and paths', () => {
    const result = customGeometry(
      custGeom(`
        <a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst>
        <a:gdLst>
          <a:gd name="inset" fmla="*/ w adj 100000"/>
          <a:gd name="right" fmla="+- r 0 inset"/>
        </a:gdLst>
        <a:ahLst>
          <a:ahXY gdRefX="adj" minX="0" maxX="50000"><a:pos x="inset" y="t"/></a:ahXY>
          <a:ahPolar gdRefAng="adj" minAng="0" maxAng="21599999"><a:pos x="hc" y="vc"/></a:ahPolar>
        </a:ahLst>
        <a:cxnLst><a:cxn ang="cd4"><a:pos x="hc" y="b"/></a:cxn></a:cxnLst>
        <a:rect l="inset" t="t" r="right" b="b"/>
        <a:pathLst>
          <a:path>
            <a:moveTo><a:pt x="inset" y="t"/></a:moveTo>
            <a:lnTo><a:pt x="right" y="t"/></a:lnTo>
            <a:cubicBezTo><a:pt x="r" y="t"/><a:pt x="r" y="b"/><a:pt x="right" y="b"/></a:cubicBezTo>
            <a:quadBezTo><a:pt x="hc" y="vc"/><a:pt x="inset" y="b"/></a:quadBezTo>
            <a:close/>
          </a:path>
          <a:path fill="none" stroke="0" extrusionOk="false" w="10" h="10">
            <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
            <a:lnTo><a:pt x="10" y="10"/></a:lnTo>
          </a:path>
          <a:path fill="darken"><a:moveTo><a:pt x="0" y="0"/></a:moveTo></a:path>
        </a:pathLst>`),
      200,
      100,
    )
    expect(result).toEqual({
      paths: [
        { d: 'M50 0L150 0C200 0 200 100 150 100Q100 50 50 100Z', fill: 'norm', stroke: true, extrusionOk: true },
        { d: 'M0 0L200 100', fill: 'none', stroke: false, extrusionOk: false },
        { d: 'M0 0', fill: 'darken', stroke: true, extrusionOk: true },
      ],
      textRect: { l: 50, t: 0, r: 150, b: 100 },
      connections: [{ x: 100, y: 100, ang: 5400000 }],
      handles: [
        { kind: 'xy', x: 50, y: 0, refX: 'adj', minX: 0, maxX: 50000 },
        { kind: 'polar', x: 100, y: 50, refAng: 'adj', minAng: 0, maxAng: 21599999 },
      ],
    })
  })

  it('defaults the text rect to the whole shape', () => {
    const result = customGeometry(custGeom('<a:pathLst><a:path/></a:pathLst>'), 30, 20)
    expect(result.textRect).toEqual({ l: 0, t: 0, r: 30, b: 20 })
    expect(result.paths).toEqual([{ d: '', fill: 'norm', stroke: true, extrusionOk: true }])
  })

  it('scales arcs drawn in a path coordinate space', () => {
    const result = customGeometry(
      custGeom(`<a:pathLst><a:path w="2" h="2">
        <a:moveTo><a:pt x="0" y="1"/></a:moveTo>
        <a:arcTo wR="1" hR="1" stAng="cd2" swAng="cd2"/>
      </a:path></a:pathLst>`),
      100,
      50,
    )
    expect(result.paths[0]?.d).toBe('M0 25A50 25 0 0 1 100 25')
  })

  it('continues arcs from the current point and splits full turns', () => {
    const result = customGeometry(
      custGeom(`<a:pathLst><a:path>
        <a:moveTo><a:pt x="100" y="50"/></a:moveTo>
        <a:arcTo wR="50" hR="50" stAng="0" swAng="21600000"/>
        <a:arcTo wR="50" hR="50" stAng="0" swAng="-5400000"/>
      </a:path></a:pathLst>`),
      100,
      100,
    )
    expect(result.paths[0]?.d).toBe('M100 50A50 50 0 0 1 0 50A50 50 0 0 1 100 50A50 50 0 0 0 50 0')
  })

  it('starts paths that open without a moveTo at the origin', () => {
    const result = customGeometry(
      custGeom('<a:pathLst><a:path><a:lnTo><a:pt x="5" y="5"/></a:lnTo><a:close/></a:path></a:pathLst>'),
      10,
      10,
    )
    expect(result.paths[0]?.d).toBe('M0 0L5 5Z')
  })

  it('survives malformed attributes and unknown elements', () => {
    const result = customGeometry(
      custGeom(`
        <a:avLst><a:gd name="adj" fmla="val NaN"/><a:gd fmla="val 5"/><a:gd name="x"/></a:avLst>
        <a:gdLst>
          <a:gd name="inf" fmla="*/ 1e308 1e308 1"/>
          <a:gd name="bad" fmla="frobnicate 1 2"/>
          <a:gd name="self" fmla="+- self 1 0"/>
          <a:gd name="huge" fmla="val ${'9'.repeat(5000)}"/>
          <a:gd name="digits" fmla="val ${'1'.repeat(50000)}x"/>
        </a:gdLst>
        <a:ahLst><a:ahXY gdRefX="adj" minX="Infinity" maxX="-"/><a:unknown/></a:ahLst>
        <a:cxnLst><a:cxn/><a:cxn ang="nope"><a:pos x="NaN" y="inf"/></a:cxn></a:cxnLst>
        <a:rect l="Infinity" t="-Infinity" r="NaN" b=""/>
        <a:pathLst>
          <a:path w="NaN" h="-5" fill="sparkle" stroke="maybe">
            <a:moveTo/>
            <a:lnTo><a:pt x="inf" y="huge"/></a:lnTo>
            <a:arcTo wR="NaN" hR="Infinity" stAng="1e400" swAng="-Infinity"/>
            <a:arcTo wR="10" hR="10" stAng="0" swAng="999999999999999999"/>
            <a:cubicBezTo><a:pt x="1"/></a:cubicBezTo>
            <a:frobnicate/>
            <a:lnTo><a:pt x="self" y="digits"/></a:lnTo>
          </a:path>
          <a:notAPath/>
        </a:pathLst>`),
      100,
      100,
    )
    expectFinite(result)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]).toMatchObject({ fill: 'norm', stroke: true })
    expect(result.paths[0]?.d).toMatch(/L1 0$/)
    // A sweep of many turns is capped: at most a full turn plus the remainder, in half turns.
    expect((result.paths[0]?.d.match(/A/g) ?? []).length).toBeLessThanOrEqual(5)
  })

  it('caps guides and path commands', () => {
    const guides = Array.from({ length: CUSTOM_GEOMETRY_LIMITS.maxGuides + 500 }, (_, index) =>
      index === 0 ? '<a:gd name="g0" fmla="val 1"/>' : `<a:gd name="g${index}" fmla="+- g${index - 1} 1 0"/>`,
    ).join('')
    const lines = Array.from(
      { length: CUSTOM_GEOMETRY_LIMITS.maxPathCommands + 500 },
      (_, index) => `<a:lnTo><a:pt x="${index % 7}" y="1"/></a:lnTo>`,
    ).join('')
    const result = customGeometry(
      custGeom(`<a:gdLst>${guides}</a:gdLst><a:pathLst><a:path>
        <a:moveTo><a:pt x="g${CUSTOM_GEOMETRY_LIMITS.maxGuides + 100}" y="g${CUSTOM_GEOMETRY_LIMITS.maxGuides - 1}"/></a:moveTo>
        ${lines}
      </a:path></a:pathLst>`),
      10,
      10,
    )
    const d = result.paths[0]?.d ?? ''
    // Guides past the cap are never defined, so they read as 0.
    expect(d.startsWith(`M0 ${CUSTOM_GEOMETRY_LIMITS.maxGuides}L`)).toBe(true)
    expect(commandCount(d)).toBe(CUSTOM_GEOMETRY_LIMITS.maxPathCommands)
  })

  it('reads elements in any namespace and ignores comments and text', () => {
    const document = parseXml(`<custGeom xmlns="${DRAWINGML_NS}"><!-- note --><pathLst>text<path>
      <moveTo><pt x="1" y="2"/></moveTo><!-- c --><lnTo><pt x="3" y="4"/></lnTo></path></pathLst></custGeom>`)
    if (!document.documentElement) throw new Error('no root')
    expect(customGeometry(document.documentElement, 10, 10).paths[0]?.d).toBe('M1 2L3 4')
  })
})
