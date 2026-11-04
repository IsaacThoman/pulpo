/**
 * DrawingML shape guides (ECMA-376 Part 1, 20.1.9.11): `name = op arg1 arg2 arg3`, where each
 * argument is an integer literal or the name of a builtin or earlier guide. Angles are in
 * 60000ths of a degree. Every result is forced finite so hostile or degenerate geometry (zero
 * sizes, division by zero) degrades to zeros instead of NaN leaking into SVG paths.
 */

export const FORMULA_OPERATORS = [
  '*/',
  '+-',
  '+/',
  '?:',
  'abs',
  'at2',
  'cat2',
  'cos',
  'max',
  'min',
  'mod',
  'pin',
  'sat2',
  'sin',
  'sqrt',
  'tan',
  'val',
] as const

export type FormulaOperator = (typeof FORMULA_OPERATORS)[number]

export interface Guide {
  name: string
  operator: FormulaOperator
  /** Up to three literal or guide-name operands. */
  operands: string[]
}

/** Guide values by name: builtins first, then adjust values and guides in document order. */
export type GuideValues = Map<string, number>

const OPERATOR_SET: ReadonlySet<string> = new Set(FORMULA_OPERATORS)
const ANGLE_UNITS_PER_DEGREE = 60000
// Unambiguous alternatives so long digit runs cannot backtrack quadratically.
const LITERAL = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/

/** `value` when finite, else 0. */
export function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function angleToRadians(angle: number): number {
  return (angle / ANGLE_UNITS_PER_DEGREE) * (Math.PI / 180)
}

function radiansToAngle(radians: number): number {
  return (radians * 180 * ANGLE_UNITS_PER_DEGREE) / Math.PI
}

/**
 * Parses `fmla` (e.g. `pin 0 adj 50000`). An unknown operator yields undefined; missing operands
 * read as 0 when evaluated.
 */
export function parseGuide(name: string, formula: string): Guide | undefined {
  const [operator, ...operands] = formula.trim().split(/\s+/)
  if (!operator || !OPERATOR_SET.has(operator)) return undefined
  return { name, operator: operator as FormulaOperator, operands: operands.slice(0, 3) }
}

/** The builtin guides (ECMA-376 Part 1, 20.1.10.56) for a shape of size `w` by `h`. */
export function builtinGuides(w: number, h: number): GuideValues {
  const ss = Math.min(w, h)
  const values: GuideValues = new Map([
    ['w', w],
    ['h', h],
    ['l', 0],
    ['t', 0],
    ['r', w],
    ['b', h],
    ['hc', w / 2],
    ['vc', h / 2],
    ['ss', ss],
    ['ls', Math.max(w, h)],
    ['cd2', 10800000],
    ['cd4', 5400000],
    ['cd8', 2700000],
    ['3cd4', 16200000],
    ['3cd8', 8100000],
    ['5cd8', 13500000],
    ['7cd8', 18900000],
  ])
  // The spec lists a subset of these divisors per dimension; defining all of them is harmless and
  // keeps custom geometry written by other producers working.
  for (const divisor of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    values.set(`wd${divisor}`, w / divisor)
    values.set(`hd${divisor}`, h / divisor)
    values.set(`ssd${divisor}`, ss / divisor)
  }
  return values
}

/** Resolves an operand: a numeric literal, else a known guide, else 0. */
export function resolveOperand(operand: string | undefined, values: GuideValues): number {
  if (operand === undefined) return 0
  if (LITERAL.test(operand)) return finite(Number(operand))
  return values.get(operand) ?? 0
}

/** Evaluates one guide against the values defined so far. */
export function evaluateGuide(guide: Guide, values: GuideValues): number {
  const [x = 0, y = 0, z = 0] = guide.operands.map((operand) => resolveOperand(operand, values))
  return finite(applyOperator(guide.operator, x, y, z))
}

function applyOperator(operator: FormulaOperator, x: number, y: number, z: number): number {
  switch (operator) {
    case '*/':
      return (x * y) / z
    case '+-':
      return x + y - z
    case '+/':
      return (x + y) / z
    case '?:':
      return x > 0 ? y : z
    case 'abs':
      return Math.abs(x)
    case 'at2':
      return radiansToAngle(Math.atan2(y, x))
    case 'cat2':
      return x * Math.cos(Math.atan2(z, y))
    case 'cos':
      return x * Math.cos(angleToRadians(y))
    case 'max':
      return Math.max(x, y)
    case 'min':
      return Math.min(x, y)
    case 'mod':
      return Math.sqrt(x * x + y * y + z * z)
    case 'pin':
      return y < x ? x : y > z ? z : y
    case 'sat2':
      return x * Math.sin(Math.atan2(z, y))
    case 'sin':
      return x * Math.sin(angleToRadians(y))
    case 'sqrt':
      return Math.sqrt(x)
    case 'tan':
      return x * Math.tan(angleToRadians(y))
    case 'val':
      return x
  }
}
