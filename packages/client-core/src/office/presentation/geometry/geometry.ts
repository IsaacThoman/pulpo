import { builtinGuides, evaluateGuide, finite, parseGuide, resolveOperand, type Guide, type GuideValues } from './formula.js'
import { PRESET_SHAPE_DATA, type PresetShapeData } from './presets.generated.js'

/**
 * DrawingML geometry (preset `a:prstGeom` and custom `a:custGeom`) to SVG path data. Coordinates
 * come out in the unit of the `w`/`h` passed in (EMU or px); angles stay in 60000ths of a degree.
 */

export type GeometryFill = 'norm' | 'none' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess'

export interface GeometryPath {
  /** SVG path data in the shape's coordinate space. */
  d: string
  /** `none` paths are outline only; the lighten/darken modes shade the shape fill. */
  fill: GeometryFill
  stroke: boolean
  extrusionOk?: boolean
}

interface GeometryHandleBase {
  /** Where the handle sits, in the same units as the paths. */
  x: number
  y: number
}

/** Drags along x and/or y; each axis drives one adjust value within its limits. */
export interface GeometryXyHandle extends GeometryHandleBase {
  kind: 'xy'
  refX?: string
  minX?: number
  maxX?: number
  refY?: string
  minY?: number
  maxY?: number
}

/** Drags around the shape: the radius and/or angle (60000ths of a degree) drive adjust values. */
export interface GeometryPolarHandle extends GeometryHandleBase {
  kind: 'polar'
  refR?: string
  minR?: number
  maxR?: number
  refAng?: string
  minAng?: number
  maxAng?: number
}

export type GeometryHandle = GeometryXyHandle | GeometryPolarHandle

export interface GeometryRect {
  l: number
  t: number
  r: number
  b: number
}

export interface GeometryConnection {
  x: number
  y: number
  /** Direction a connector leaves this site, in 60000ths of a degree. */
  ang: number
}

export interface GeometryResult {
  paths: GeometryPath[]
  /** Where text goes, in the same units as the paths. */
  textRect: GeometryRect
  connections: GeometryConnection[]
  handles: GeometryHandle[]
}

/**
 * The subset of a DOM element this module reads, satisfied by both browser and @xmldom/xmldom
 * elements.
 */
export interface GeometryElement {
  readonly nodeType: number
  readonly localName: string | null
  getAttribute(name: string): string | null
  readonly childNodes: { readonly length: number; item(index: number): { readonly nodeType: number } | null }
}

/** Limits on custom geometry, against hostile files. Real freeforms stay far below these. */
export const CUSTOM_GEOMETRY_LIMITS = {
  /** Adjust values plus guides. */
  maxGuides: 2000,
  /** Handles plus connection sites. */
  maxSites: 2000,
  maxPaths: 2000,
  /** Path commands across all paths; traced freeforms (maps, logos) can run to thousands of points. */
  maxPathCommands: 20000,
} as const

type PathOperator = 'M' | 'L' | 'A' | 'C' | 'Q' | 'Z'

interface PathCommand {
  operator: PathOperator
  /** Points as x/y operand pairs, or `wR hR stAng swAng` for arcs. */
  operands: string[]
}

interface PathDefinition {
  commands: PathCommand[]
  /** The path's own coordinate space, when it differs from the shape's (0 = the shape's). */
  w: number
  h: number
  fill: GeometryFill
  stroke: boolean
  extrusionOk: boolean
}

interface HandleDefinition {
  kind: 'xy' | 'polar'
  /** The x (or radius) reference and limits, then the y (or angle) reference and limits. */
  first: HandleAxis
  second: HandleAxis
  x: string
  y: string
}

interface HandleAxis {
  ref?: string
  min?: string
  max?: string
}

interface ConnectionDefinition {
  ang: string
  x: string
  y: string
}

interface ShapeDefinition {
  adjusts: Guide[]
  guides: Guide[]
  handles: HandleDefinition[]
  connections: ConnectionDefinition[]
  textRect?: [string, string, string, string]
  paths: PathDefinition[]
}

const OPERAND_COUNTS: Record<PathOperator, number> = { M: 2, L: 2, A: 4, C: 6, Q: 4, Z: 0 }
const FILLS: ReadonlySet<string> = new Set<GeometryFill>([
  'norm',
  'none',
  'lighten',
  'lightenLess',
  'darken',
  'darkenLess',
])

export const PRESET_SHAPE_NAMES: readonly string[] = Object.freeze(Object.keys(PRESET_SHAPE_DATA))

/** PowerPoint's Insert > Shapes gallery. Labels are English; the UI translates by `id`. */
export const PRESET_SHAPE_GALLERY: readonly { id: string; label: string; shapes: readonly string[] }[] = [
  { id: 'lines', label: 'Lines', shapes: ['line', 'straightConnector1', 'bentConnector3', 'curvedConnector3'] },
  {
    id: 'rectangles',
    label: 'Rectangles',
    shapes: [
      'rect',
      'roundRect',
      'snip1Rect',
      'snip2SameRect',
      'snip2DiagRect',
      'snipRoundRect',
      'round1Rect',
      'round2SameRect',
      'round2DiagRect',
    ],
  },
  {
    id: 'basicShapes',
    label: 'Basic Shapes',
    shapes: [
      'ellipse',
      'triangle',
      'rtTriangle',
      'parallelogram',
      'trapezoid',
      'diamond',
      'pentagon',
      'hexagon',
      'heptagon',
      'octagon',
      'decagon',
      'dodecagon',
      'pie',
      'chord',
      'teardrop',
      'frame',
      'halfFrame',
      'corner',
      'diagStripe',
      'plus',
      'plaque',
      'can',
      'cube',
      'bevel',
      'donut',
      'noSmoking',
      'blockArc',
      'foldedCorner',
      'smileyFace',
      'heart',
      'lightningBolt',
      'sun',
      'moon',
      'cloud',
      'arc',
      'bracketPair',
      'bracePair',
      'leftBracket',
      'rightBracket',
      'leftBrace',
      'rightBrace',
    ],
  },
  {
    id: 'blockArrows',
    label: 'Block Arrows',
    shapes: [
      'rightArrow',
      'leftArrow',
      'upArrow',
      'downArrow',
      'leftRightArrow',
      'upDownArrow',
      'quadArrow',
      'leftRightUpArrow',
      'bentArrow',
      'uturnArrow',
      'leftUpArrow',
      'bentUpArrow',
      'curvedRightArrow',
      'curvedLeftArrow',
      'curvedUpArrow',
      'curvedDownArrow',
      'stripedRightArrow',
      'notchedRightArrow',
      'homePlate',
      'chevron',
      'rightArrowCallout',
      'downArrowCallout',
      'leftArrowCallout',
      'upArrowCallout',
      'leftRightArrowCallout',
      'quadArrowCallout',
      'circularArrow',
    ],
  },
  {
    id: 'equationShapes',
    label: 'Equation Shapes',
    shapes: ['mathPlus', 'mathMinus', 'mathMultiply', 'mathDivide', 'mathEqual', 'mathNotEqual'],
  },
  {
    id: 'flowchart',
    label: 'Flowchart',
    shapes: [
      'flowChartProcess',
      'flowChartAlternateProcess',
      'flowChartDecision',
      'flowChartInputOutput',
      'flowChartPredefinedProcess',
      'flowChartInternalStorage',
      'flowChartDocument',
      'flowChartMultidocument',
      'flowChartTerminator',
      'flowChartPreparation',
      'flowChartManualInput',
      'flowChartManualOperation',
      'flowChartConnector',
      'flowChartOffpageConnector',
      'flowChartPunchedCard',
      'flowChartPunchedTape',
      'flowChartSummingJunction',
      'flowChartOr',
      'flowChartCollate',
      'flowChartSort',
      'flowChartExtract',
      'flowChartMerge',
      'flowChartOnlineStorage',
      'flowChartDelay',
      'flowChartMagneticTape',
      'flowChartMagneticDisk',
      'flowChartMagneticDrum',
      'flowChartDisplay',
    ],
  },
  {
    id: 'starsAndBanners',
    label: 'Stars and Banners',
    shapes: [
      'irregularSeal1',
      'irregularSeal2',
      'star4',
      'star5',
      'star6',
      'star7',
      'star8',
      'star10',
      'star12',
      'star16',
      'star24',
      'star32',
      'ribbon2',
      'ribbon',
      'ellipseRibbon2',
      'ellipseRibbon',
      'verticalScroll',
      'horizontalScroll',
      'wave',
      'doubleWave',
    ],
  },
  {
    id: 'callouts',
    label: 'Callouts',
    shapes: [
      'wedgeRectCallout',
      'wedgeRoundRectCallout',
      'wedgeEllipseCallout',
      'cloudCallout',
      'borderCallout1',
      'borderCallout2',
      'borderCallout3',
      'accentCallout1',
      'accentCallout2',
      'accentCallout3',
      'callout1',
      'callout2',
      'callout3',
      'accentBorderCallout1',
      'accentBorderCallout2',
      'accentBorderCallout3',
    ],
  },
  {
    id: 'actionButtons',
    label: 'Action Buttons',
    shapes: [
      'actionButtonBackPrevious',
      'actionButtonForwardNext',
      'actionButtonBeginning',
      'actionButtonEnd',
      'actionButtonHome',
      'actionButtonInformation',
      'actionButtonReturn',
      'actionButtonMovie',
      'actionButtonDocument',
      'actionButtonSound',
      'actionButtonHelp',
      'actionButtonBlank',
    ],
  },
]

const compiledPresets = new Map<string, ShapeDefinition>()

function presetDefinition(name: string): ShapeDefinition | undefined {
  if (!Object.hasOwn(PRESET_SHAPE_DATA, name)) return undefined
  let definition = compiledPresets.get(name)
  if (!definition) {
    const data = PRESET_SHAPE_DATA[name]
    if (!data) return undefined
    definition = compilePreset(data)
    compiledPresets.set(name, definition)
  }
  return definition
}

/**
 * The geometry of preset shape `name` (an `a:prstGeom/@prst` value) at size `w` by `h`.
 * `adjust` overrides the shape's adjust values by name (`adj`, `adj1`, ...). Undefined for
 * unknown names.
 */
export function presetGeometry(
  name: string,
  w: number,
  h: number,
  adjust?: Record<string, number>,
): GeometryResult | undefined {
  const definition = presetDefinition(name)
  return definition && evaluateShape(definition, w, h, adjust)
}

/** The default adjust values of preset shape `name` ({} for unknown names or shapes without any). */
export function adjustDefaults(name: string): Record<string, number> {
  const definition = presetDefinition(name)
  const defaults: Record<string, number> = {}
  if (!definition) return defaults
  const values = builtinGuides(0, 0)
  for (const guide of definition.adjusts) {
    const value = evaluateGuide(guide, values)
    values.set(guide.name, value)
    defaults[guide.name] = value
  }
  return defaults
}

/** The geometry of an `a:custGeom` element at size `w` by `h`. Never throws on malformed input. */
export function customGeometry(custGeom: GeometryElement, w: number, h: number): GeometryResult {
  return evaluateShape(parseCustomGeometry(custGeom), w, h)
}

// Compiling: preset data and custom geometry XML both become a ShapeDefinition.

function compileGuideList(entries: readonly string[] | undefined): Guide[] {
  const guides: Guide[] = []
  for (const entry of entries ?? []) {
    const space = entry.indexOf(' ')
    const guide = parseGuide(entry.slice(0, space), entry.slice(space + 1))
    if (guide) guides.push(guide)
  }
  return guides
}

function compileHandle(entry: string): HandleDefinition | undefined {
  const [kind, firstRef, firstMin, firstMax, secondRef, secondMin, secondMax, x = '0', y = '0'] = entry.split(' ')
  if (kind !== 'xy' && kind !== 'polar') return undefined
  const present = (token: string | undefined) => (token === undefined || token === '-' ? undefined : token)
  return {
    kind,
    first: { ref: present(firstRef), min: present(firstMin), max: present(firstMax) },
    second: { ref: present(secondRef), min: present(secondMin), max: present(secondMax) },
    x,
    y,
  }
}

function compilePathCommands(d: string): PathCommand[] {
  const tokens = d.split(' ')
  const commands: PathCommand[] = []
  let index = 0
  while (index < tokens.length) {
    const operator = tokens[index] as PathOperator
    const count = OPERAND_COUNTS[operator]
    commands.push({ operator, operands: tokens.slice(index + 1, index + 1 + count) })
    index += 1 + count
  }
  return commands
}

function compilePreset(data: PresetShapeData): ShapeDefinition {
  const [l = 'l', t = 't', r = 'r', b = 'b'] = data.rect?.split(' ') ?? []
  return {
    adjusts: compileGuideList(data.av),
    guides: compileGuideList(data.gd),
    handles: (data.ah ?? []).flatMap((entry) => compileHandle(entry) ?? []),
    connections: (data.cxn ?? []).map((entry) => {
      const [ang = '0', x = '0', y = '0'] = entry.split(' ')
      return { ang, x, y }
    }),
    textRect: data.rect ? [l, t, r, b] : undefined,
    paths: data.paths.map((path) => ({
      commands: compilePathCommands(path.d),
      w: path.w ?? 0,
      h: path.h ?? 0,
      fill: path.fill ?? 'norm',
      stroke: path.stroke ?? true,
      extrusionOk: path.extrusionOk ?? true,
    })),
  }
}

function* childElements(element: GeometryElement, limit = Infinity): Generator<GeometryElement> {
  let yielded = 0
  for (let index = 0; index < element.childNodes.length && yielded < limit; index++) {
    const child = element.childNodes.item(index)
    if (child?.nodeType !== 1) continue
    yielded++
    yield child as GeometryElement
  }
}

function firstChild(element: GeometryElement, localName: string): GeometryElement | undefined {
  for (const child of childElements(element)) if (child.localName === localName) return child
  return undefined
}

/** An attribute as a guide operand; absent or blank reads as `fallback`. */
function operandAttribute(element: GeometryElement | undefined, name: string, fallback = '0'): string {
  const value = element?.getAttribute(name)?.trim()
  return value ? value : fallback
}

function optionalAttribute(element: GeometryElement, name: string): string | undefined {
  const value = element.getAttribute(name)?.trim()
  return value ? value : undefined
}

function parseCustomGuides(list: GeometryElement | undefined, budget: { remaining: number }): Guide[] {
  const guides: Guide[] = []
  if (!list) return guides
  for (const gd of childElements(list)) {
    if (budget.remaining <= 0) break
    budget.remaining--
    if (gd.localName !== 'gd') continue
    const guide = parseGuide(gd.getAttribute('name') ?? '', gd.getAttribute('fmla') ?? '')
    if (guide) guides.push(guide)
  }
  return guides
}

function parseCustomHandle(handle: GeometryElement): HandleDefinition | undefined {
  const pos = firstChild(handle, 'pos')
  const axis = (ref: string, min: string, max: string): HandleAxis => ({
    ref: optionalAttribute(handle, ref),
    min: optionalAttribute(handle, min),
    max: optionalAttribute(handle, max),
  })
  const position = { x: operandAttribute(pos, 'x'), y: operandAttribute(pos, 'y') }
  if (handle.localName === 'ahXY') {
    return { kind: 'xy', first: axis('gdRefX', 'minX', 'maxX'), second: axis('gdRefY', 'minY', 'maxY'), ...position }
  }
  if (handle.localName === 'ahPolar') {
    return {
      kind: 'polar',
      first: axis('gdRefR', 'minR', 'maxR'),
      second: axis('gdRefAng', 'minAng', 'maxAng'),
      ...position,
    }
  }
  return undefined
}

function parsePathCommand(element: GeometryElement): PathCommand | undefined {
  const points = (count: number) =>
    [...childElements(element, count)]
      .filter((pt) => pt.localName === 'pt')
      .flatMap((pt) => [operandAttribute(pt, 'x'), operandAttribute(pt, 'y')])
  switch (element.localName) {
    case 'moveTo':
      return { operator: 'M', operands: points(1) }
    case 'lnTo':
      return { operator: 'L', operands: points(1) }
    case 'cubicBezTo':
      return { operator: 'C', operands: points(3) }
    case 'quadBezTo':
      return { operator: 'Q', operands: points(2) }
    case 'arcTo':
      return {
        operator: 'A',
        operands: ['wR', 'hR', 'stAng', 'swAng'].map((name) => operandAttribute(element, name)),
      }
    case 'close':
      return { operator: 'Z', operands: [] }
    default:
      return undefined
  }
}

/** A path dimension: a non-negative integer, else 0 (meaning the shape's own space). */
function pathDimension(path: GeometryElement, name: string): number {
  const value = Number(path.getAttribute(name) ?? '')
  return Number.isFinite(value) && value > 0 ? value : 0
}

function parseCustomPath(path: GeometryElement, budget: { remaining: number }): PathDefinition {
  const commands: PathCommand[] = []
  for (const element of childElements(path)) {
    if (budget.remaining <= 0) break
    budget.remaining--
    const command = parsePathCommand(element)
    if (command) commands.push(command)
  }
  const fill = path.getAttribute('fill') ?? 'norm'
  return {
    commands,
    w: pathDimension(path, 'w'),
    h: pathDimension(path, 'h'),
    fill: FILLS.has(fill) ? (fill as GeometryFill) : 'norm',
    stroke: !isFalse(path.getAttribute('stroke')),
    extrusionOk: !isFalse(path.getAttribute('extrusionOk')),
  }
}

/** xsd:boolean false. */
function isFalse(value: string | null): boolean {
  return value === 'false' || value === '0'
}

function parseCustomGeometry(custGeom: GeometryElement): ShapeDefinition {
  const limits = CUSTOM_GEOMETRY_LIMITS
  const guideBudget = { remaining: limits.maxGuides }
  const adjusts = parseCustomGuides(firstChild(custGeom, 'avLst'), guideBudget)
  const guides = parseCustomGuides(firstChild(custGeom, 'gdLst'), guideBudget)

  const siteBudget = { remaining: limits.maxSites }
  const handles: HandleDefinition[] = []
  const handleList = firstChild(custGeom, 'ahLst')
  for (const element of handleList ? childElements(handleList, siteBudget.remaining) : []) {
    const handle = parseCustomHandle(element)
    if (handle) handles.push(handle)
    siteBudget.remaining--
  }
  const connections: ConnectionDefinition[] = []
  const connectionList = firstChild(custGeom, 'cxnLst')
  for (const cxn of connectionList ? childElements(connectionList, siteBudget.remaining) : []) {
    if (cxn.localName !== 'cxn') continue
    const pos = firstChild(cxn, 'pos')
    connections.push({ ang: operandAttribute(cxn, 'ang'), x: operandAttribute(pos, 'x'), y: operandAttribute(pos, 'y') })
  }

  const rect = firstChild(custGeom, 'rect')
  const textRect: ShapeDefinition['textRect'] = rect && [
    operandAttribute(rect, 'l', 'l'),
    operandAttribute(rect, 't', 't'),
    operandAttribute(rect, 'r', 'r'),
    operandAttribute(rect, 'b', 'b'),
  ]

  const commandBudget = { remaining: limits.maxPathCommands }
  const paths: PathDefinition[] = []
  const pathList = firstChild(custGeom, 'pathLst')
  for (const path of pathList ? childElements(pathList, limits.maxPaths) : []) {
    if (path.localName === 'path') paths.push(parseCustomPath(path, commandBudget))
  }
  return { adjusts, guides, handles, connections, textRect, paths }
}

// Evaluating a ShapeDefinition at a size.

function evaluateShape(
  definition: ShapeDefinition,
  w: number,
  h: number,
  adjust?: Record<string, number>,
): GeometryResult {
  const width = Math.max(0, finite(w))
  const height = Math.max(0, finite(h))
  const values = builtinGuides(width, height)
  for (const guide of definition.adjusts) {
    const override = adjust && Object.hasOwn(adjust, guide.name) ? adjust[guide.name] : undefined
    values.set(
      guide.name,
      typeof override === 'number' && Number.isFinite(override) ? override : evaluateGuide(guide, values),
    )
  }
  for (const guide of definition.guides) values.set(guide.name, evaluateGuide(guide, values))

  const value = (operand: string | undefined) => resolveOperand(operand, values)
  const [l, t, r, b] = definition.textRect ?? ['l', 't', 'r', 'b']
  return {
    paths: definition.paths.map((path) => ({
      d: pathData(path, values, width, height),
      fill: path.fill,
      stroke: path.stroke,
      extrusionOk: path.extrusionOk,
    })),
    textRect: { l: value(l), t: value(t), r: value(r), b: value(b) },
    connections: definition.connections.map((cxn) => ({ x: value(cxn.x), y: value(cxn.y), ang: value(cxn.ang) })),
    handles: definition.handles.map((handle) => evaluateHandle(handle, values)),
  }
}

function evaluateHandle(handle: HandleDefinition, values: GuideValues): GeometryHandle {
  const value = (operand: string | undefined) => (operand === undefined ? undefined : resolveOperand(operand, values))
  const x = resolveOperand(handle.x, values)
  const y = resolveOperand(handle.y, values)
  const { first, second } = handle
  if (handle.kind === 'xy') {
    return withoutUndefined({
      kind: 'xy',
      x,
      y,
      refX: first.ref,
      minX: value(first.min),
      maxX: value(first.max),
      refY: second.ref,
      minY: value(second.min),
      maxY: value(second.max),
    })
  }
  return withoutUndefined({
    kind: 'polar',
    x,
    y,
    refR: first.ref,
    minR: value(first.min),
    maxR: value(first.max),
    refAng: second.ref,
    minAng: value(second.min),
    maxAng: value(second.max),
  })
}

/** Drops undefined properties so results compare and serialize cleanly. */
function withoutUndefined<T extends object>(object: T): T {
  for (const key of Object.keys(object) as (keyof T)[]) if (object[key] === undefined) delete object[key]
  return object
}

/** Formats a coordinate for SVG: finite, at most three decimals, no `-0`. */
function formatNumber(value: number): string {
  const rounded = Math.round(finite(value) * 1000) / 1000
  return String(rounded === 0 ? 0 : rounded)
}

const FULL_TURN = 2 * Math.PI

/** DrawingML angle units to radians. */
function radians(angle: number): number {
  return (angle / 60000) * (Math.PI / 180)
}

/**
 * The ellipse parameter whose point lies in direction `angle` from the center. DrawingML arc
 * angles are visual (the direction from the center), not the parametric angle SVG and the
 * ellipse equation use; whole turns are kept so sweeps of 360° and more survive.
 */
function ellipseParameter(angle: number, wR: number, hR: number): number {
  // A flat ellipse is a segment; atan2 would snap every angle to its center.
  if (wR === 0 || hR === 0) return angle
  const parameter = Math.atan2(wR * Math.sin(angle), hR * Math.cos(angle))
  return parameter + FULL_TURN * Math.round((angle - parameter) / FULL_TURN)
}

/** Builds the SVG path data of one path, in the shape's coordinate space. */
function pathData(path: PathDefinition, values: GuideValues, w: number, h: number): string {
  const scaleX = path.w > 0 ? w / path.w : 1
  const scaleY = path.h > 0 ? h / path.h : 1
  const out: string[] = []
  const point = (x: number, y: number) => `${formatNumber(x * scaleX)} ${formatNumber(y * scaleY)}`
  let current = { x: 0, y: 0 }
  let subpathStart = { x: 0, y: 0 }
  let started = false
  // SVG needs a moveto first; DrawingML paths that open with another command start at the origin.
  const ensureStarted = () => {
    if (!started) out.push(`M${point(current.x, current.y)}`)
    started = true
  }

  for (const command of path.commands) {
    const n = command.operands.map((operand) => resolveOperand(operand, values))
    const at = (index: number) => n[index] ?? 0
    switch (command.operator) {
      case 'M':
        current = { x: at(0), y: at(1) }
        subpathStart = current
        started = true
        out.push(`M${point(current.x, current.y)}`)
        break
      case 'L':
        ensureStarted()
        current = { x: at(0), y: at(1) }
        out.push(`L${point(current.x, current.y)}`)
        break
      case 'C':
        ensureStarted()
        current = { x: at(4), y: at(5) }
        out.push(`C${point(at(0), at(1))} ${point(at(2), at(3))} ${point(current.x, current.y)}`)
        break
      case 'Q':
        ensureStarted()
        current = { x: at(2), y: at(3) }
        out.push(`Q${point(at(0), at(1))} ${point(current.x, current.y)}`)
        break
      case 'A':
        ensureStarted()
        current = arcTo(out, current, at(0), at(1), at(2), at(3), scaleX, scaleY)
        break
      case 'Z':
        if (started) out.push('Z')
        current = subpathStart
        break
    }
  }
  return out.join('')
}

/**
 * Appends an `arcTo` from `current` as SVG arcs and returns the end point. The ellipse center
 * follows from the current point sitting at `stAng` on it. Sweeps are split into pieces of at
 * most half a turn so SVG's endpoint arcs stay unambiguous, and capped at two turns so hostile
 * angles cannot produce unbounded output.
 */
function arcTo(
  out: string[],
  current: { x: number; y: number },
  wRadius: number,
  hRadius: number,
  stAng: number,
  swAng: number,
  scaleX: number,
  scaleY: number,
): { x: number; y: number } {
  const wR = Math.abs(wRadius)
  const hR = Math.abs(hRadius)
  const start = ellipseParameter(radians(stAng), wR, hR)
  const end = ellipseParameter(radians(stAng + swAng), wR, hR)
  const centerX = current.x - wR * Math.cos(start)
  const centerY = current.y - hR * Math.sin(start)

  let sweep = finite(end - start)
  if (Math.abs(sweep) > 2 * FULL_TURN) sweep = Math.sign(sweep) * (FULL_TURN + (Math.abs(sweep) % FULL_TURN))
  const pieces = Math.ceil(Math.abs(sweep) / Math.PI)
  const radii = `${formatNumber(wR * scaleX)} ${formatNumber(hR * scaleY)}`
  const sweepFlag = sweep > 0 ? 1 : 0
  let x = current.x
  let y = current.y
  for (let piece = 1; piece <= pieces; piece++) {
    const parameter = start + (sweep * piece) / pieces
    x = centerX + wR * Math.cos(parameter)
    y = centerY + hR * Math.sin(parameter)
    out.push(`A${radii} 0 0 ${sweepFlag} ${formatNumber(x * scaleX)} ${formatNumber(y * scaleY)}`)
  }
  return { x, y }
}
