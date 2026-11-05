/**
 * The spreadsheet function library. `LIBRARY_FUNCTIONS` holds every function implemented here;
 * `functionRegistry` builds the name → spec map the evaluator looks functions up in, with the
 * evaluator's own functions (IF, LET, INDEX, …) and the text-format ones (TEXT, VALUE, …) passed
 * in as `extra`. `FUNCTION_DOCS` documents all of them for autocomplete and argument hints.
 */

import type { FunctionSpec } from '../types.js'
import { ARRAY_FUNCTIONS } from './array.js'
import { DATABASE_FUNCTIONS } from './database.js'
import { DATETIME_FUNCTIONS } from './datetime.js'
import { ENGINEERING_FUNCTIONS } from './engineering.js'
import { FINANCIAL_FUNCTIONS } from './financial.js'
import { INFORMATION_FUNCTIONS } from './information.js'
import { LOGICAL_FUNCTIONS } from './logical.js'
import { LOOKUP_FUNCTIONS } from './lookup.js'
import { MATH_FUNCTIONS } from './math.js'
import { STATISTICAL_FUNCTIONS } from './statistical.js'
import { TEXT_FUNCTIONS } from './text.js'

export { FUNCTION_DOCS, functionDoc, type FunctionArgDoc, type FunctionCategory, type FunctionDoc } from './docs.js'
export { numberToText } from './coerce.js'
export { parseCriteria, wildcardMatch, wildcardRegex, type Predicate } from './criteria.js'
export { roundDecimal } from './numeric.js'

export const LIBRARY_FUNCTIONS: FunctionSpec[] = [
  ...MATH_FUNCTIONS,
  ...STATISTICAL_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...LOGICAL_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
  ...ARRAY_FUNCTIONS,
  ...DATETIME_FUNCTIONS,
  ...INFORMATION_FUNCTIONS,
  ...FINANCIAL_FUNCTIONS,
  ...ENGINEERING_FUNCTIONS,
  ...DATABASE_FUNCTIONS,
]

/**
 * Name → spec for the library plus `extra` (evaluator and text-format functions). Names are
 * upper-case without `_xlfn.`; a later spec with the same name replaces an earlier one, so
 * `extra` can override library functions.
 */
export function functionRegistry(extra: FunctionSpec[] = []): Map<string, FunctionSpec> {
  const registry = new Map<string, FunctionSpec>()
  for (const spec of [...LIBRARY_FUNCTIONS, ...extra]) registry.set(spec.name.toUpperCase(), spec)
  return registry
}
