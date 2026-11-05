/** Logical functions (IF, IFS, SWITCH, … are control flow and live in the evaluator). */

import { Errors, isError, type FunctionContext, type FunctionSpec } from '../types.js'
import { bool, define, fail, type Args } from './coerce.js'
import { forEachValue } from './iterate.js'

/**
 * The logicals AND/OR/XOR see: direct arguments coerce (numbers, TRUE/FALSE text; other text is
 * #VALUE!), while text and blanks inside references and arrays are skipped. No logicals at all is
 * #VALUE!; errors propagate.
 */
function logicals(ctx: FunctionContext, args: Args): boolean[] {
  const out: boolean[] = []
  forEachValue(ctx, args, (value, direct) => {
    if (isError(value)) fail(value)
    if (typeof value === 'boolean') out.push(value)
    else if (typeof value === 'number') out.push(value !== 0)
    else if (direct && value === null) out.push(false)
    else if (direct && typeof value === 'string') out.push(bool(value))
  })
  if (!out.length) fail(Errors.VALUE)
  return out
}

export const LOGICAL_FUNCTIONS: FunctionSpec[] = [
  define({ name: 'AND', min: 1, max: 255, args: ['any'], fn: (ctx, args) => logicals(ctx, args).every(Boolean) }),
  define({ name: 'OR', min: 1, max: 255, args: ['any'], fn: (ctx, args) => logicals(ctx, args).some(Boolean) }),
  define({ name: 'XOR', min: 1, max: 254, args: ['any'], xlfn: true, fn: (ctx, args) => logicals(ctx, args).filter(Boolean).length % 2 === 1 }),
  define({ name: 'NOT', min: 1, max: 1, fn: (ctx, args) => !bool(args[0], ctx) }),
  define({ name: 'TRUE', min: 0, max: 0, fn: () => true }),
  define({ name: 'FALSE', min: 0, max: 0, fn: () => false }),
]
