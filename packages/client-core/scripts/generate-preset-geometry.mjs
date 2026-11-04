#!/usr/bin/env node
/**
 * Regenerates src/office/presentation/geometry/presets.generated.ts from the ECMA-376
 * presetShapeDefinitions.xml (Apache POI ships a copy under the Apache License 2.0:
 * poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml).
 *
 *   node packages/client-core/scripts/generate-preset-geometry.mjs <path-to-presetShapeDefinitions.xml>
 *
 * The XML is treated as untrusted input: every name and formula is checked against a strict
 * character set before it is written into TypeScript source.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser } from '@xmldom/xmldom'

const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/office/presentation/geometry/presets.generated.ts',
)

/** Shape names are plain identifiers. */
const SHAPE_NAME = /^[A-Za-z][A-Za-z0-9]*$/
/** Guide names, literals, and formula operators: nothing that could end a string literal. */
const SAFE_TOKEN = /^[A-Za-z0-9_*+/?:.-]+$/
/** Single-letter tokens reserved for path commands in the compact path string. */
const PATH_COMMAND_LETTERS = new Set(['M', 'L', 'A', 'C', 'Q', 'Z'])
const FILL_MODES = new Set(['norm', 'none', 'lighten', 'lightenLess', 'darken', 'darkenLess'])

function fail(message) {
  throw new Error(`presetShapeDefinitions.xml: ${message}`)
}

function childElements(element) {
  const children = []
  for (let index = 0; index < element.childNodes.length; index++) {
    const child = element.childNodes.item(index)
    if (child && child.nodeType === 1) children.push(child)
  }
  return children
}

function child(element, localName) {
  return childElements(element).find((candidate) => candidate.localName === localName)
}

function token(value, where) {
  if (value === null || value === undefined || value === '') fail(`missing value in ${where}`)
  if (!SAFE_TOKEN.test(value)) fail(`unexpected characters in ${where}: ${JSON.stringify(value)}`)
  return value
}

/** An optional handle reference or limit, `-` when absent. */
function optionalToken(element, attribute, where) {
  const value = element.getAttribute(attribute)
  return value ? token(value, `${where}@${attribute}`) : '-'
}

function guides(list, where) {
  if (!list) return undefined
  return childElements(list)
    .filter((gd) => gd.localName === 'gd')
    .map((gd) => {
      const name = token(gd.getAttribute('name'), `${where} gd name`)
      if (PATH_COMMAND_LETTERS.has(name)) fail(`${where}: guide name ${name} collides with a path command`)
      const formula = (gd.getAttribute('fmla') ?? '').trim().split(/\s+/)
      return [name, ...formula.map((part) => token(part, `${where} gd ${name}`))].join(' ')
    })
}

function point(element, where) {
  const pt = child(element, 'pt')
  if (!pt) fail(`${where}: missing pt`)
  return [token(pt.getAttribute('x'), `${where} x`), token(pt.getAttribute('y'), `${where} y`)]
}

function handles(list, where) {
  if (!list) return undefined
  return childElements(list).map((handle) => {
    const pos = child(handle, 'pos')
    if (!pos) fail(`${where}: handle without pos`)
    const position = [token(pos.getAttribute('x'), `${where} pos`), token(pos.getAttribute('y'), `${where} pos`)]
    if (handle.localName === 'ahXY') {
      const attributes = ['gdRefX', 'minX', 'maxX', 'gdRefY', 'minY', 'maxY']
      return ['xy', ...attributes.map((name) => optionalToken(handle, name, where)), ...position].join(' ')
    }
    if (handle.localName === 'ahPolar') {
      const attributes = ['gdRefR', 'minR', 'maxR', 'gdRefAng', 'minAng', 'maxAng']
      return ['polar', ...attributes.map((name) => optionalToken(handle, name, where)), ...position].join(' ')
    }
    return fail(`${where}: unknown handle ${handle.localName}`)
  })
}

function connections(list, where) {
  if (!list) return undefined
  return childElements(list).map((cxn) => {
    const pos = child(cxn, 'pos')
    if (!pos) fail(`${where}: connection without pos`)
    return [
      token(cxn.getAttribute('ang'), `${where} cxn ang`),
      token(pos.getAttribute('x'), `${where} cxn x`),
      token(pos.getAttribute('y'), `${where} cxn y`),
    ].join(' ')
  })
}

function pathCommands(path, where) {
  const parts = []
  for (const command of childElements(path)) {
    switch (command.localName) {
      case 'moveTo':
        parts.push('M', ...point(command, where))
        break
      case 'lnTo':
        parts.push('L', ...point(command, where))
        break
      case 'arcTo':
        parts.push(
          'A',
          ...['wR', 'hR', 'stAng', 'swAng'].map((name) => token(command.getAttribute(name), `${where} arcTo ${name}`)),
        )
        break
      case 'cubicBezTo':
      case 'quadBezTo': {
        const points = childElements(command).filter((pt) => pt.localName === 'pt')
        const expected = command.localName === 'cubicBezTo' ? 3 : 2
        if (points.length !== expected) fail(`${where}: ${command.localName} needs ${expected} points`)
        parts.push(command.localName === 'cubicBezTo' ? 'C' : 'Q')
        for (const pt of points) parts.push(token(pt.getAttribute('x'), where), token(pt.getAttribute('y'), where))
        break
      }
      case 'close':
        parts.push('Z')
        break
      default:
        fail(`${where}: unknown path command ${command.localName}`)
    }
  }
  return parts.join(' ')
}

function dimension(path, attribute, where) {
  const value = path.getAttribute(attribute)
  if (!value) return undefined
  if (!/^\d+$/.test(value)) fail(`${where}: bad path ${attribute}`)
  return Number(value)
}

function paths(list, where) {
  if (!list) fail(`${where}: missing pathLst`)
  return childElements(list)
    .filter((path) => path.localName === 'path')
    .map((path) => {
      const data = { d: pathCommands(path, where) }
      const w = dimension(path, 'w', where)
      const h = dimension(path, 'h', where)
      if (w) data.w = w
      if (h) data.h = h
      const fill = path.getAttribute('fill')
      if (fill && fill !== 'norm') {
        if (!FILL_MODES.has(fill)) fail(`${where}: bad fill ${fill}`)
        data.fill = fill
      }
      if (path.getAttribute('stroke') === 'false') data.stroke = false
      if (path.getAttribute('extrusionOk') === 'false') data.extrusionOk = false
      return data
    })
}

function textRect(rect, where) {
  if (!rect) return undefined
  return ['l', 't', 'r', 'b'].map((side) => token(rect.getAttribute(side), `${where} rect ${side}`)).join(' ')
}

function shape(element) {
  const where = element.localName
  const data = {}
  const av = guides(child(element, 'avLst'), where)
  const gd = guides(child(element, 'gdLst'), where)
  const ah = handles(child(element, 'ahLst'), where)
  const cxn = connections(child(element, 'cxnLst'), where)
  const rect = textRect(child(element, 'rect'), where)
  if (av?.length) data.av = av
  if (gd?.length) data.gd = gd
  if (ah?.length) data.ah = ah
  if (cxn?.length) data.cxn = cxn
  if (rect) data.rect = rect
  data.paths = paths(child(element, 'pathLst'), where)
  return data
}

function literal(value) {
  if (typeof value === 'string') return `'${value}'`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`
  return `{ ${Object.entries(value)
    .map(([key, entry]) => `${key}: ${literal(entry)}`)
    .join(', ')} }`
}

function render(shapes) {
  const lines = [
    '// Generated by packages/client-core/scripts/generate-preset-geometry.mjs. Do not edit by hand.',
    '//',
    '// Source: ECMA-376 Part 1, Annex D, presetShapeDefinitions.xml, as distributed by Apache POI',
    '// (https://github.com/apache/poi, poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml)',
    '// under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0).',
    '',
    '/** One path of a preset shape. Path commands: `M x y`, `L x y`, `A wR hR stAng swAng`, `C x1 y1 x2 y2 x y`, `Q x1 y1 x y`, `Z`. */',
    'export interface PresetPathData {',
    '  d: string',
    '  /** Coordinate space width when the path is drawn in its own units. */',
    '  w?: number',
    '  h?: number',
    "  fill?: 'none' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess'",
    '  stroke?: false',
    '  extrusionOk?: false',
    '}',
    '',
    '/** A preset shape in compact form; every guide is `name op args...`. */',
    'export interface PresetShapeData {',
    '  /** Adjust values and their defaults. */',
    '  av?: readonly string[]',
    '  gd?: readonly string[]',
    '  /** `xy gdRefX minX maxX gdRefY minY maxY x y` or `polar gdRefR minR maxR gdRefAng minAng maxAng x y`; `-` when absent. */',
    '  ah?: readonly string[]',
    '  /** `ang x y` */',
    '  cxn?: readonly string[]',
    '  /** `l t r b` */',
    '  rect?: string',
    '  paths: readonly PresetPathData[]',
    '}',
    '',
    'export const PRESET_SHAPE_DATA: Readonly<Record<string, PresetShapeData>> = {',
  ]
  for (const [name, data] of shapes) {
    lines.push(`  ${name}: {`)
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        lines.push(`    ${key}: [`)
        for (const entry of value) lines.push(`      ${literal(entry)},`)
        lines.push('    ],')
      } else {
        lines.push(`    ${key}: ${literal(value)},`)
      }
    }
    lines.push('  },')
  }
  lines.push('}', '')
  return lines.join('\n')
}

function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('usage: node generate-preset-geometry.mjs <path-to-presetShapeDefinitions.xml>')
    process.exit(1)
  }
  const document = new DOMParser().parseFromString(readFileSync(inputPath, 'utf8'), 'application/xml')
  const root = document.documentElement
  if (!root) fail('no root element')
  const shapes = []
  const seen = new Set()
  for (const element of childElements(root)) {
    const name = element.localName
    if (!SHAPE_NAME.test(name)) fail(`bad shape name ${JSON.stringify(name)}`)
    if (seen.has(name)) fail(`duplicate shape ${name}`)
    seen.add(name)
    shapes.push([name, shape(element)])
  }
  shapes.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  writeFileSync(OUTPUT_PATH, render(shapes))
  console.log(`wrote ${shapes.length} preset shapes to ${OUTPUT_PATH}`)
}

main()
