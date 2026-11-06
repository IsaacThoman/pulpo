/** Text functions (the number-formatting ones, TEXT/VALUE/FIXED/…, live in text-format.ts). */

import { maxOf } from '../../../../collections.js'

import { Errors, isError, matrix, type FunctionContext, type FunctionSpec, type Scalar, type Value } from '../types.js'
import { MAX_TEXT_LENGTH, bool, check, checkArraySize, defBool, defInt, define, fail, int, omitted, optInt, scalarOf, text, toMatrix, type Args } from './coerce.js'
import { wildcardIndex } from './criteria.js'

/** Windows-1252 for 0x80–0x9F, which Excel's CHAR/CODE use on Windows; the rest matches Latin-1. */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
}
const CP1252_REVERSE = new Map(Object.entries(CP1252_HIGH).map(([byte, code]) => [code, Number(byte)]))

/** Excel strings are UTF-16: lengths and positions count code units, so an emoji is 2 characters. */
function chars(s: string): string[] {
  return s.split('')
}

function lengthArg(ctx: FunctionContext, args: Args, index: number, fallback: number): number {
  const n = index >= args.length ? fallback : int(args[index], ctx)
  check(n >= 0, Errors.VALUE)
  return n
}

function proper(s: string): string {
  let out = ''
  let previousLetter = false
  for (const ch of s) {
    const isLetter = /\p{L}/u.test(ch)
    out += isLetter ? (previousLetter ? ch.toLowerCase() : ch.toUpperCase()) : ch
    previousLetter = isLetter
  }
  return out
}

/** All values of `any` arguments flattened to text, for CONCAT and TEXTJOIN. */
function flatTexts(ctx: FunctionContext, args: Args): string[] {
  const out: string[] = []
  let length = 0
  for (const arg of args) {
    for (const v of toMatrix(ctx, arg).data) {
      if (isError(v)) fail(v)
      const part = text(v)
      length += part.length
      if (length > MAX_TEXT_LENGTH) fail(Errors.VALUE)
      out.push(part)
    }
  }
  return out
}

function joinText(parts: string[], separator = ''): string {
  const length = parts.reduce((total, part) => total + part.length, 0) + Math.max(0, parts.length - 1) * separator.length
  if (length > MAX_TEXT_LENGTH) fail(Errors.VALUE)
  return parts.join(separator)
}

function checkLength(s: string): string {
  if (s.length > MAX_TEXT_LENGTH) fail(Errors.VALUE)
  return s
}

// ---------------------------------------------------------------------------------------------
// TEXTBEFORE / TEXTAFTER / TEXTSPLIT

function delimiters(ctx: FunctionContext, value: Value | undefined): string[] {
  const m = toMatrix(ctx, value)
  return m.data.map((v) => {
    if (isError(v)) fail(v)
    return text(v)
  })
}

interface Hit {
  index: number
  length: number
}

/** Every occurrence of any delimiter, left to right, non-overlapping. */
function findAll(haystack: string, delims: string[], ignoreCase: boolean): Hit[] {
  const h = ignoreCase ? haystack.toLowerCase() : haystack
  const ds = delims.filter((d) => d !== '').map((d) => (ignoreCase ? d.toLowerCase() : d))
  const hits: Hit[] = []
  let i = 0
  while (i <= h.length) {
    let best: Hit | undefined
    for (const d of ds) {
      const at = h.indexOf(d, i)
      if (at >= 0 && (!best || at < best.index || (at === best.index && d.length > best.length))) best = { index: at, length: d.length }
    }
    if (!best) break
    hits.push(best)
    i = best.index + Math.max(best.length, 1)
  }
  return hits
}

function textAround(ctx: FunctionContext, args: Args, before: boolean): Value {
  const source = text(scalarOf(args[0], ctx))
  const delims = delimiters(ctx, args[1])
  const instance = defInt(args, 2, 1, ctx)
  const ignoreCase = defInt(args, 3, 0, ctx) === 1
  const matchEnd = defBool(args, 4, false, ctx)
  const notFound = (): Value => (args.length > 5 && args[5] !== undefined ? scalarOf(args[5], ctx) : fail(Errors.NA))
  if (instance === 0 || Math.abs(instance) > Math.max(source.length, 1)) return fail(Errors.VALUE)
  if (delims.every((d) => d === '')) {
    // An empty delimiter matches at the very start (or the very end when counting from the end).
    if (instance > 0) return before ? '' : source
    return before ? source : ''
  }
  let hits = findAll(source, delims, ignoreCase)
  if (matchEnd) hits = instance > 0 ? [...hits, { index: source.length, length: 0 }] : [{ index: 0, length: 0 }, ...hits]
  const hit = instance > 0 ? hits[instance - 1] : hits[hits.length + instance]
  if (!hit) return notFound()
  return before ? source.slice(0, hit.index) : source.slice(hit.index + hit.length)
}

function splitBy(source: string, delims: string[], ignoreCase: boolean): string[] {
  if (!delims.some((d) => d !== '')) return [source]
  const parts: string[] = []
  let start = 0
  for (const hit of findAll(source, delims, ignoreCase)) {
    parts.push(source.slice(start, hit.index))
    start = hit.index + hit.length
  }
  parts.push(source.slice(start))
  return parts
}

function textSplit(ctx: FunctionContext, args: Args): Value {
  const source = text(scalarOf(args[0], ctx))
  const colDelims = omitted(args, 1) ? [] : delimiters(ctx, args[1])
  const rowDelims = omitted(args, 2) ? [] : delimiters(ctx, args[2])
  const ignoreEmpty = defBool(args, 3, false, ctx)
  const ignoreCase = defInt(args, 4, 0, ctx) === 1
  const pad: Scalar = omitted(args, 5) ? Errors.NA : scalarOf(args[5], ctx)
  if (!colDelims.some((d) => d !== '') && !rowDelims.some((d) => d !== '')) return fail(Errors.VALUE)
  let rows = splitBy(source, rowDelims, ignoreCase)
  if (ignoreEmpty) rows = rows.filter((r) => r !== '')
  let grid = rows.map((row) => {
    const cells = splitBy(row, colDelims, ignoreCase)
    return ignoreEmpty ? cells.filter((c) => c !== '') : cells
  })
  grid = grid.filter((row) => row.length > 0)
  if (!grid.length) return fail(Errors.CALC)
  const width = maxOf(grid.map((r) => r.length))
  checkArraySize(grid.length, width)
  const data: Scalar[] = []
  for (const row of grid) for (let c = 0; c < width; c++) data.push(c < row.length ? row[c]! : pad)
  return matrix(grid.length, width, data)
}

function arrayToText(ctx: FunctionContext, args: Args): string {
  const m = toMatrix(ctx, args[0])
  const format = defInt(args, 1, 0, ctx)
  check(format === 0 || format === 1, Errors.VALUE)
  const render = (v: Scalar, strict: boolean): string => {
    if (v === null) return ''
    if (isError(v)) return v.code
    if (typeof v === 'string') return strict ? `"${v.replace(/"/g, '""')}"` : v
    return text(v)
  }
  if (format === 0) return joinText(m.data.map((v) => render(v, false)), ', ')
  const rows: string[] = []
  for (let r = 0; r < m.rows; r++) rows.push(joinText(m.data.slice(r * m.cols, (r + 1) * m.cols).map((v) => render(v, true)), ','))
  const body = joinText(rows, ';')
  if (body.length + 2 > MAX_TEXT_LENGTH) fail(Errors.VALUE)
  return `{${body}}`
}

export const TEXT_FUNCTIONS: FunctionSpec[] = [
  define({ name: 'CONCATENATE', min: 1, max: 255, fn: (ctx, args) => joinText(args.map((a) => text(a, ctx))) }),
  define({ name: 'CONCAT', min: 1, max: 254, args: ['any'], xlfn: true, fn: (ctx, args) => joinText(flatTexts(ctx, args)) }),
  define({
    name: 'TEXTJOIN',
    min: 3,
    max: 252,
    args: ['any', 'scalar', 'any'],
    xlfn: true,
    fn: (ctx, args) => {
      const delims = delimiters(ctx, args[0])
      const ignoreEmpty = bool(args[1], ctx)
      let values = flatTexts(ctx, args.slice(2))
      if (ignoreEmpty) values = values.filter((v) => v !== '')
      let out = ''
      values.forEach((v, i) => {
        const delimiter = i > 0 && delims.length ? delims[(i - 1) % delims.length]! : ''
        if (out.length + delimiter.length + v.length > MAX_TEXT_LENGTH) fail(Errors.VALUE)
        out += delimiter + v
      })
      return checkLength(out)
    },
  }),
  ...['LEFT', 'LEFTB'].map((name) =>
    define({
      name,
      min: 1,
      max: 2,
      fn: (ctx, args) => chars(text(args[0], ctx)).slice(0, lengthArg(ctx, args, 1, 1)).join(''),
    }),
  ),
  ...['RIGHT', 'RIGHTB'].map((name) =>
    define({
      name,
      min: 1,
      max: 2,
      fn: (ctx, args) => {
        const cs = chars(text(args[0], ctx))
        const n = lengthArg(ctx, args, 1, 1)
        return n === 0 ? '' : cs.slice(Math.max(0, cs.length - n)).join('')
      },
    }),
  ),
  ...['MID', 'MIDB'].map((name) =>
    define({
      name,
      min: 3,
      max: 3,
      fn: (ctx, args) => {
        const cs = chars(text(args[0], ctx))
        const start = int(args[1], ctx)
        const n = int(args[2], ctx)
        check(start >= 1 && n >= 0, Errors.VALUE)
        return cs.slice(start - 1, start - 1 + n).join('')
      },
    }),
  ),
  ...['LEN', 'LENB'].map((name) => define({ name, min: 1, max: 1, fn: (ctx, args) => chars(text(args[0], ctx)).length })),
  define({ name: 'LOWER', min: 1, max: 1, fn: (ctx, args) => text(args[0], ctx).toLowerCase() }),
  define({ name: 'UPPER', min: 1, max: 1, fn: (ctx, args) => text(args[0], ctx).toUpperCase() }),
  define({ name: 'PROPER', min: 1, max: 1, fn: (ctx, args) => proper(text(args[0], ctx)) }),
  define({ name: 'TRIM', min: 1, max: 1, fn: (ctx, args) => text(args[0], ctx).replace(/ +/g, ' ').replace(/^ | $/g, '') }),
  define({
    name: 'CLEAN',
    min: 1,
    max: 1,
    // Drops the non-printable ASCII characters 0–31.
    fn: (ctx, args) => Array.from(text(args[0], ctx)).filter((ch) => ch.charCodeAt(0) >= 32).join(''),
  }),
  define({
    name: 'SUBSTITUTE',
    min: 3,
    max: 4,
    fn: (ctx, args) => {
      const source = text(args[0], ctx)
      const old = text(args[1], ctx)
      const replacement = text(args[2], ctx)
      if (args.length > 3) {
        const instance = int(args[3], ctx)
        check(instance >= 1, Errors.VALUE)
        if (!old) return source
        let at = -1
        let from = 0
        for (let i = 0; i < instance; i++) {
          at = source.indexOf(old, from)
          if (at < 0) return source
          from = at + old.length
        }
        return checkLength(source.slice(0, at) + replacement + source.slice(at + old.length))
      }
      if (!old) return source
      const parts = source.split(old)
      check(source.length + (parts.length - 1) * (replacement.length - old.length) <= MAX_TEXT_LENGTH, Errors.VALUE)
      return parts.join(replacement)
    },
  }),
  ...['REPLACE', 'REPLACEB'].map((name) =>
    define({
      name,
      min: 4,
      max: 4,
      fn: (ctx, args) => {
        const cs = chars(text(args[0], ctx))
        const start = int(args[1], ctx)
        const n = int(args[2], ctx)
        check(start >= 1 && n >= 0, Errors.VALUE)
        return checkLength([...cs.slice(0, start - 1), text(args[3], ctx), ...cs.slice(start - 1 + n)].join(''))
      },
    }),
  ),
  ...['FIND', 'FINDB'].map((name) =>
    define({
      name,
      min: 2,
      max: 3,
      fn: (ctx, args) => {
        const needle = text(args[0], ctx)
        const haystack = chars(text(args[1], ctx))
        const start = optInt(args, 2, 1, ctx)
        check(start >= 1 && start <= haystack.length + 1, Errors.VALUE)
        if (!needle) return start
        const rest = haystack.slice(start - 1).join('')
        const at = rest.indexOf(needle)
        if (at < 0) return fail(Errors.VALUE)
        return start + at
      },
    }),
  ),
  ...['SEARCH', 'SEARCHB'].map((name) =>
    define({
      name,
      min: 2,
      max: 3,
      fn: (ctx, args) => {
        const needle = text(args[0], ctx)
        const haystack = chars(text(args[1], ctx))
        const start = optInt(args, 2, 1, ctx)
        check(start >= 1 && start <= haystack.length + 1, Errors.VALUE)
        if (!needle) return start
        const rest = haystack.slice(start - 1).join('')
        const index = wildcardIndex(needle, rest)
        if (index < 0) return fail(Errors.VALUE)
        return start + index
      },
    }),
  ),
  define({
    name: 'REPT',
    min: 2,
    max: 2,
    fn: (ctx, args) => {
      const s = text(args[0], ctx)
      const n = int(args[1], ctx)
      check(n >= 0, Errors.VALUE)
      if (s.length * n > MAX_TEXT_LENGTH) return fail(Errors.VALUE)
      return s.repeat(n)
    },
  }),
  define({ name: 'EXACT', min: 2, max: 2, fn: (ctx, args) => text(args[0], ctx) === text(args[1], ctx) }),
  define({
    name: 'CHAR',
    min: 1,
    max: 1,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      check(n >= 1 && n <= 255, Errors.VALUE)
      return String.fromCharCode(CP1252_HIGH[n] ?? n)
    },
  }),
  define({
    name: 'CODE',
    min: 1,
    max: 1,
    fn: (ctx, args) => {
      const s = text(args[0], ctx)
      if (!s) return fail(Errors.VALUE)
      const code = s.codePointAt(0)!
      if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code
      return CP1252_REVERSE.get(code) ?? 63
    },
  }),
  define({
    name: 'UNICHAR',
    min: 1,
    max: 1,
    xlfn: true,
    fn: (ctx, args) => {
      const n = int(args[0], ctx)
      check(n >= 1 && n <= 0x10ffff, Errors.VALUE)
      if (n >= 0xd800 && n <= 0xdfff) return fail(Errors.NA)
      return String.fromCodePoint(n)
    },
  }),
  define({
    name: 'UNICODE',
    min: 1,
    max: 1,
    xlfn: true,
    fn: (ctx, args) => {
      const s = text(args[0], ctx)
      if (!s) return fail(Errors.VALUE)
      return s.codePointAt(0)!
    },
  }),
  define({
    name: 'T',
    min: 1,
    max: 1,
    fn: (ctx, args) => {
      const v = scalarOf(args[0], ctx)
      if (isError(v)) return fail(v)
      return typeof v === 'string' ? v : ''
    },
  }),
  define({ name: 'TEXTBEFORE', min: 2, max: 6, args: ['scalar', 'any', 'scalar'], xlfn: true, fn: (ctx, args) => textAround(ctx, args, true) }),
  define({ name: 'TEXTAFTER', min: 2, max: 6, args: ['scalar', 'any', 'scalar'], xlfn: true, fn: (ctx, args) => textAround(ctx, args, false) }),
  define({ name: 'TEXTSPLIT', min: 2, max: 6, args: ['scalar', 'any', 'any', 'scalar'], xlfn: true, fn: textSplit }),
  define({ name: 'ARRAYTOTEXT', min: 1, max: 2, args: ['any', 'scalar'], xlfn: true, fn: arrayToText }),
]
