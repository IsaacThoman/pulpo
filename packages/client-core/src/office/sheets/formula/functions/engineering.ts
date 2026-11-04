/** Engineering functions: base conversions, bit operations, DELTA/GESTEP, ERF, and CONVERT. */

import { Errors, isError, type FunctionContext, type FunctionSpec, type Value } from '../types.js'
import { check, defNum, define, fail, num, numberToText, omitted, scalarOf, text, type Args } from './coerce.js'
import { erf, erfc } from './special.js'

interface Base {
  radix: number
  /** Two's complement width in bits (10 digits of the base). */
  bits: number
}

const BASES: Record<'BIN' | 'OCT' | 'DEC' | 'HEX', Base> = {
  BIN: { radix: 2, bits: 10 },
  OCT: { radix: 8, bits: 30 },
  DEC: { radix: 10, bits: 0 },
  HEX: { radix: 16, bits: 40 },
}

/** Reads a BIN/OCT/HEX argument (text or a number written in that base) as a signed value. */
function readBased(ctx: FunctionContext, value: Value | undefined, base: Base): number {
  const v = scalarOf(value, ctx)
  if (isError(v)) return fail(v)
  if (typeof v === 'boolean') return fail(Errors.VALUE)
  const s = (typeof v === 'number' ? numberToText(v) : text(v)).trim().toUpperCase()
  if (s === '') return 0
  if (s.length > 10) return fail(Errors.NUM)
  const digits = '0123456789ABCDEF'.slice(0, base.radix)
  let n = 0
  for (const ch of s) {
    const d = digits.indexOf(ch)
    if (d < 0) return fail(Errors.NUM)
    n = n * base.radix + d
  }
  // Ten digits with the top bit set are negative (two's complement).
  if (s.length === 10 && n >= 2 ** (base.bits - 1)) n -= 2 ** base.bits
  return n
}

/** Writes a signed value in BIN/OCT/HEX: negatives as 10-digit two's complement, `places` pads. */
function writeBased(n: number, base: Base, placesArg: Value | undefined, hasPlaces: boolean, ctx: FunctionContext): string {
  const limit = 2 ** (base.bits - 1)
  check(n >= -limit && n < limit)
  if (n < 0) return (n + 2 ** base.bits).toString(base.radix).toUpperCase()
  const s = n.toString(base.radix).toUpperCase()
  if (!hasPlaces) return s
  const places = Math.trunc(num(placesArg, ctx))
  check(places >= 0 && places <= 10 && places >= s.length)
  return s.padStart(places, '0')
}

function convertBase(name: string, from: keyof typeof BASES, to: keyof typeof BASES): FunctionSpec {
  const hasPlacesArg = to !== 'DEC'
  return define({
    name,
    min: 1,
    max: hasPlacesArg ? 2 : 1,
    fn: (ctx, args) => {
      let n: number
      if (from === 'DEC') {
        n = Math.trunc(num(args[0], ctx))
      } else n = readBased(ctx, args[0], BASES[from])
      if (to === 'DEC') return n
      return writeBased(n, BASES[to], args[1], args.length > 1 && args[1] !== undefined, ctx)
    },
  })
}

const BIT_LIMIT = 2 ** 48

function bitArg(ctx: FunctionContext, value: Value | undefined): bigint {
  const n = num(value, ctx)
  check(Number.isInteger(n) && n >= 0 && n < BIT_LIMIT)
  return BigInt(n)
}

function bitOp(name: string, op: (a: bigint, b: bigint) => bigint): FunctionSpec {
  return define({ name, min: 2, max: 2, xlfn: true, fn: (ctx, args) => Number(op(bitArg(ctx, args[0]), bitArg(ctx, args[1]))) })
}

function shift(ctx: FunctionContext, args: Args, left: boolean): number {
  const n = bitArg(ctx, args[0])
  const amount = Math.trunc(num(args[1], ctx))
  check(Math.abs(amount) <= 53)
  const s = left ? amount : -amount
  const result = s >= 0 ? n << BigInt(s) : n >> BigInt(-s)
  check(result < BigInt(BIT_LIMIT))
  return Number(result)
}

// ---------------------------------------------------------------------------------------------
// CONVERT

type Category = 'mass' | 'distance' | 'time' | 'pressure' | 'force' | 'energy' | 'power' | 'magnetism' | 'temperature' | 'volume' | 'area' | 'information' | 'speed'

interface Unit {
  category: Category
  /** Value of one unit in the category's base unit. */
  factor: number
  /** Accepts SI (and for information, binary) prefixes. */
  prefixable?: boolean
}

const IN = 0.0254
const FT = 12 * IN
const YD = 3 * FT
const MI = 1760 * YD
const GAL = 231 * IN ** 3
const LBM = 0.45359237
const G = 9.80665

const UNITS: Record<string, Unit> = {
  // Mass, base kilogram... expressed in grams so "g" takes prefixes naturally.
  g: { category: 'mass', factor: 1, prefixable: true },
  sg: { category: 'mass', factor: 14593.902937206, prefixable: false },
  lbm: { category: 'mass', factor: LBM * 1000 },
  u: { category: 'mass', factor: 1.66053906660e-24, prefixable: true },
  ozm: { category: 'mass', factor: (LBM * 1000) / 16 },
  grain: { category: 'mass', factor: 0.06479891 },
  cwt: { category: 'mass', factor: 100 * LBM * 1000 },
  shweight: { category: 'mass', factor: 100 * LBM * 1000 },
  uk_cwt: { category: 'mass', factor: 112 * LBM * 1000 },
  lcwt: { category: 'mass', factor: 112 * LBM * 1000 },
  stone: { category: 'mass', factor: 14 * LBM * 1000 },
  ton: { category: 'mass', factor: 2000 * LBM * 1000 },
  uk_ton: { category: 'mass', factor: 2240 * LBM * 1000 },
  LTON: { category: 'mass', factor: 2240 * LBM * 1000 },
  // Distance, base meter.
  m: { category: 'distance', factor: 1, prefixable: true },
  mi: { category: 'distance', factor: MI },
  Nmi: { category: 'distance', factor: 1852 },
  in: { category: 'distance', factor: IN },
  ft: { category: 'distance', factor: FT },
  yd: { category: 'distance', factor: YD },
  ang: { category: 'distance', factor: 1e-10, prefixable: true },
  ell: { category: 'distance', factor: 45 * IN },
  ly: { category: 'distance', factor: 9460730472580800, prefixable: true },
  parsec: { category: 'distance', factor: 30856775814913700, prefixable: true },
  pc: { category: 'distance', factor: 30856775814913700, prefixable: true },
  Picapt: { category: 'distance', factor: IN / 72 },
  Pica: { category: 'distance', factor: IN / 72 },
  pica: { category: 'distance', factor: IN / 6 },
  survey_mi: { category: 'distance', factor: 1609.3472186944373 },
  // Time, base second.
  yr: { category: 'time', factor: 365.25 * 86400 },
  day: { category: 'time', factor: 86400 },
  d: { category: 'time', factor: 86400 },
  hr: { category: 'time', factor: 3600 },
  mn: { category: 'time', factor: 60 },
  min: { category: 'time', factor: 60 },
  sec: { category: 'time', factor: 1, prefixable: true },
  s: { category: 'time', factor: 1, prefixable: true },
  // Pressure, base pascal.
  Pa: { category: 'pressure', factor: 1, prefixable: true },
  p: { category: 'pressure', factor: 1, prefixable: true },
  atm: { category: 'pressure', factor: 101325, prefixable: true },
  at: { category: 'pressure', factor: 101325, prefixable: true },
  mmHg: { category: 'pressure', factor: 133.322, prefixable: true },
  psi: { category: 'pressure', factor: (LBM * G) / IN ** 2 },
  Torr: { category: 'pressure', factor: 101325 / 760 },
  // Force, base newton.
  N: { category: 'force', factor: 1, prefixable: true },
  dyn: { category: 'force', factor: 1e-5, prefixable: true },
  dy: { category: 'force', factor: 1e-5, prefixable: true },
  lbf: { category: 'force', factor: LBM * G },
  pond: { category: 'force', factor: 0.00980665, prefixable: true },
  // Energy, base joule.
  J: { category: 'energy', factor: 1, prefixable: true },
  e: { category: 'energy', factor: 1e-7, prefixable: true },
  c: { category: 'energy', factor: 4.184, prefixable: true },
  cal: { category: 'energy', factor: 4.1868, prefixable: true },
  eV: { category: 'energy', factor: 1.602176634e-19, prefixable: true },
  ev: { category: 'energy', factor: 1.602176634e-19, prefixable: true },
  HPh: { category: 'energy', factor: 2684519.5376961729 },
  hh: { category: 'energy', factor: 2684519.5376961729 },
  Wh: { category: 'energy', factor: 3600, prefixable: true },
  wh: { category: 'energy', factor: 3600, prefixable: true },
  flb: { category: 'energy', factor: FT * LBM * G },
  BTU: { category: 'energy', factor: 1055.05585262 },
  btu: { category: 'energy', factor: 1055.05585262 },
  // Power, base watt.
  W: { category: 'power', factor: 1, prefixable: true },
  w: { category: 'power', factor: 1, prefixable: true },
  HP: { category: 'power', factor: 745.6998715822702 },
  h: { category: 'power', factor: 745.6998715822702 },
  PS: { category: 'power', factor: 735.49875 },
  // Magnetism, base tesla.
  T: { category: 'magnetism', factor: 1, prefixable: true },
  ga: { category: 'magnetism', factor: 1e-4, prefixable: true },
  // Temperature is affine and handled separately; the factor is unused.
  C: { category: 'temperature', factor: 1 },
  cel: { category: 'temperature', factor: 1 },
  F: { category: 'temperature', factor: 1 },
  fah: { category: 'temperature', factor: 1 },
  K: { category: 'temperature', factor: 1, prefixable: true },
  kel: { category: 'temperature', factor: 1, prefixable: true },
  Rank: { category: 'temperature', factor: 1 },
  Reau: { category: 'temperature', factor: 1 },
  // Volume, base liter.
  l: { category: 'volume', factor: 1, prefixable: true },
  L: { category: 'volume', factor: 1, prefixable: true },
  lt: { category: 'volume', factor: 1, prefixable: true },
  tsp: { category: 'volume', factor: (GAL * 1000) / 768 },
  tspm: { category: 'volume', factor: 0.005 },
  tbs: { category: 'volume', factor: (GAL * 1000) / 256 },
  oz: { category: 'volume', factor: (GAL * 1000) / 128 },
  cup: { category: 'volume', factor: (GAL * 1000) / 16 },
  pt: { category: 'volume', factor: (GAL * 1000) / 8 },
  us_pt: { category: 'volume', factor: (GAL * 1000) / 8 },
  uk_pt: { category: 'volume', factor: 0.56826125 },
  qt: { category: 'volume', factor: (GAL * 1000) / 4 },
  uk_qt: { category: 'volume', factor: 1.1365225 },
  gal: { category: 'volume', factor: GAL * 1000 },
  uk_gal: { category: 'volume', factor: 4.54609 },
  m3: { category: 'volume', factor: 1000, prefixable: true },
  mi3: { category: 'volume', factor: MI ** 3 * 1000 },
  yd3: { category: 'volume', factor: YD ** 3 * 1000 },
  ft3: { category: 'volume', factor: FT ** 3 * 1000 },
  in3: { category: 'volume', factor: IN ** 3 * 1000 },
  ang3: { category: 'volume', factor: 1e-27, prefixable: true },
  barrel: { category: 'volume', factor: 42 * GAL * 1000 },
  bushel: { category: 'volume', factor: 35.23907016688 },
  // Area, base square meter.
  m2: { category: 'area', factor: 1, prefixable: true },
  mi2: { category: 'area', factor: MI ** 2 },
  Nmi2: { category: 'area', factor: 1852 ** 2 },
  yd2: { category: 'area', factor: YD ** 2 },
  ft2: { category: 'area', factor: FT ** 2 },
  in2: { category: 'area', factor: IN ** 2 },
  ang2: { category: 'area', factor: 1e-20, prefixable: true },
  ar: { category: 'area', factor: 100, prefixable: true },
  ha: { category: 'area', factor: 10000 },
  uk_acre: { category: 'area', factor: 4046.8564224 },
  us_acre: { category: 'area', factor: 4046.872609874252 },
  Morgen: { category: 'area', factor: 2500 },
  // Information, base bit.
  bit: { category: 'information', factor: 1, prefixable: true },
  byte: { category: 'information', factor: 8, prefixable: true },
  // Speed, base meter per second.
  'm/s': { category: 'speed', factor: 1, prefixable: true },
  'm/sec': { category: 'speed', factor: 1, prefixable: true },
  'm/h': { category: 'speed', factor: 1 / 3600, prefixable: true },
  'm/hr': { category: 'speed', factor: 1 / 3600, prefixable: true },
  mph: { category: 'speed', factor: MI / 3600 },
  kn: { category: 'speed', factor: 1852 / 3600 },
  admkn: { category: 'speed', factor: 1853.184 / 3600 },
}

const SI_PREFIXES: Record<string, number> = {
  Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
}

const BINARY_PREFIXES: Record<string, number> = { Yi: 2 ** 80, Zi: 2 ** 70, Ei: 2 ** 60, Pi: 2 ** 50, Ti: 2 ** 40, Gi: 2 ** 30, Mi: 2 ** 20, ki: 2 ** 10 }

function lookupUnit(name: string): { unit: Unit; name: string; scale: number } | undefined {
  const direct = UNITS[name]
  if (direct) return { unit: direct, name, scale: 1 }
  for (const [prefix, scale] of [...Object.entries(BINARY_PREFIXES), ...Object.entries(SI_PREFIXES)]) {
    if (!name.startsWith(prefix)) continue
    const rest = name.slice(prefix.length)
    const unit = UNITS[rest]
    if (!unit?.prefixable) continue
    const binary = prefix in BINARY_PREFIXES
    if (binary && unit.category !== 'information') continue
    // Squared and cubed units scale with the prefix squared or cubed.
    const power = /2$/.test(rest) && unit.category === 'area' ? 2 : /3$/.test(rest) && unit.category === 'volume' ? 3 : 1
    return { unit, name: rest, scale: scale ** power }
  }
  return undefined
}

function toKelvin(value: number, unit: string, scale: number): number {
  switch (unit) {
    case 'C':
    case 'cel':
      return value + 273.15
    case 'F':
    case 'fah':
      return ((value - 32) * 5) / 9 + 273.15
    case 'Rank':
      return (value * 5) / 9
    case 'Reau':
      return value * 1.25 + 273.15
    default:
      return value * scale
  }
}

function fromKelvin(value: number, unit: string, scale: number): number {
  switch (unit) {
    case 'C':
    case 'cel':
      return value - 273.15
    case 'F':
    case 'fah':
      return ((value - 273.15) * 9) / 5 + 32
    case 'Rank':
      return (value * 9) / 5
    case 'Reau':
      return (value - 273.15) / 1.25
    default:
      return value / scale
  }
}

function convert(ctx: FunctionContext, args: Args): number {
  const value = num(args[0], ctx)
  const from = lookupUnit(text(args[1], ctx))
  const to = lookupUnit(text(args[2], ctx))
  if (!from || !to || from.unit.category !== to.unit.category) return fail(Errors.NA)
  if (from.unit.category === 'temperature') return fromKelvin(toKelvin(value, from.name, from.scale), to.name, to.scale)
  const result = (value * from.unit.factor * from.scale) / (to.unit.factor * to.scale)
  return Number(result.toPrecision(15))
}

export const ENGINEERING_FUNCTIONS: FunctionSpec[] = [
  convertBase('BIN2DEC', 'BIN', 'DEC'),
  convertBase('BIN2HEX', 'BIN', 'HEX'),
  convertBase('BIN2OCT', 'BIN', 'OCT'),
  convertBase('DEC2BIN', 'DEC', 'BIN'),
  convertBase('DEC2HEX', 'DEC', 'HEX'),
  convertBase('DEC2OCT', 'DEC', 'OCT'),
  convertBase('HEX2BIN', 'HEX', 'BIN'),
  convertBase('HEX2DEC', 'HEX', 'DEC'),
  convertBase('HEX2OCT', 'HEX', 'OCT'),
  convertBase('OCT2BIN', 'OCT', 'BIN'),
  convertBase('OCT2DEC', 'OCT', 'DEC'),
  convertBase('OCT2HEX', 'OCT', 'HEX'),
  bitOp('BITAND', (a, b) => a & b),
  bitOp('BITOR', (a, b) => a | b),
  bitOp('BITXOR', (a, b) => a ^ b),
  define({ name: 'BITLSHIFT', min: 2, max: 2, xlfn: true, fn: (ctx, args) => shift(ctx, args, true) }),
  define({ name: 'BITRSHIFT', min: 2, max: 2, xlfn: true, fn: (ctx, args) => shift(ctx, args, false) }),
  define({ name: 'DELTA', min: 1, max: 2, fn: (ctx, args) => (num(args[0], ctx) === defNum(args, 1, 0, ctx) ? 1 : 0) }),
  define({ name: 'GESTEP', min: 1, max: 2, fn: (ctx, args) => (num(args[0], ctx) >= defNum(args, 1, 0, ctx) ? 1 : 0) }),
  define({
    name: 'ERF',
    min: 1,
    max: 2,
    fn: (ctx, args) => {
      const lower = num(args[0], ctx)
      if (omitted(args, 1)) return erf(lower)
      return erf(num(args[1], ctx)) - erf(lower)
    },
  }),
  define({ name: 'ERF.PRECISE', min: 1, max: 1, xlfn: true, fn: (ctx, args) => erf(num(args[0], ctx)) }),
  ...['ERFC', 'ERFC.PRECISE'].map((name) => define({ name, min: 1, max: 1, xlfn: name.includes('.'), fn: (ctx, args) => erfc(num(args[0], ctx)) })),
  define({ name: 'CONVERT', min: 3, max: 3, fn: convert }),
]
