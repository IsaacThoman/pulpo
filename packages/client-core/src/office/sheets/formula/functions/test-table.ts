/** Table-driven test helper shared by the function tests (imports vitest, so tests only). */

import { describe, expect, it } from 'vitest'
import type { Value } from '../types.js'
import { call, createContext, mismatch, type TestContext } from './testing.js'

export type Case = [name: string, args: (Value | undefined)[], expected: unknown, tolerance?: number]

/** One `it` per case: calls the function by name and compares with `mismatch`. */
export function table(title: string, cases: Case[], ctx: () => TestContext = () => createContext()): void {
  describe(title, () => {
    it.each(cases.map((c, i) => [`${c[0]} #${i + 1}`, ...c] as const))('%s', (_label, name, args, expected, tolerance) => {
      expect(mismatch(call(name, args, ctx()), expected, tolerance)).toBeUndefined()
    })
  })
}
