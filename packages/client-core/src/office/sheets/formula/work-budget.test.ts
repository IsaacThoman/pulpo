import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { FormulaEngine } from './engine.js'
import { EVALUATOR_FUNCTIONS } from './builtins.js'
import { functionRegistry } from './functions/index.js'
import { TEXT_FORMAT_FUNCTIONS } from './functions/text-format.js'
import type { FunctionSpec } from './types.js'

/**
 * Independently count loop bodies in a fresh copy of the production interpreter. A missing
 * consumeWork must fail deterministically, even if the loop happens to run quickly on CI.
 * The watchdog also interrupts a regressed/infinite loop before it hangs the test runner.
 * Nothing is instrumented in the shipped engine; imports share this loader's module cache,
 * including CalculationStopped's identity and the synchronous budget state.
 */
function guardedEngine(omitSubstituteCharge = false) {
  let active = false, iterations = 0, tripped = false
  const maxIterations = 2_000
  const tick = () => {
    if (active && ++iterations > maxIterations) {
      tripped = true
      active = false
      throw new Error('Unbudgeted formula loop')
    }
  }
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const load = (file: string): Record<string, unknown> => {
    const cached = cache.get(file)
    if (cached) return cached.exports
    const module = { exports: {} }
    cache.set(file, module)
    let source = readFileSync(file, 'utf8')
    if (omitSubstituteCharge && file.endsWith('/functions/text.ts')) source = source.replace('for (let i = 0; i < instance; i++) {\n          consumeWork()', 'for (let i = 0; i < instance; i++) {')
    const code = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      transformers: { before: [(context) => {
        const visit: ts.Visitor = (node) => {
          const next = ts.visitEachChild(node, visit, context)
          if (ts.isForStatement(next) || ts.isForOfStatement(next) || ts.isForInStatement(next) || ts.isWhileStatement(next) || ts.isDoStatement(next)) {
            const body = next.statement
            const tickStatement = ts.factory.createExpressionStatement(ts.factory.createCallExpression(ts.factory.createIdentifier('__formulaGuardTick'), undefined, []))
            const block = ts.factory.createBlock([tickStatement, ...(ts.isBlock(body) ? body.statements : [body])], true)
            if (ts.isForStatement(next)) return ts.factory.updateForStatement(next, next.initializer, next.condition, next.incrementor, block)
            if (ts.isForOfStatement(next)) return ts.factory.updateForOfStatement(next, next.awaitModifier, next.initializer, next.expression, block)
            if (ts.isForInStatement(next)) return ts.factory.updateForInStatement(next, next.initializer, next.expression, block)
            if (ts.isWhileStatement(next)) return ts.factory.updateWhileStatement(next, next.expression, block)
            return ts.factory.updateDoStatement(next, block, next.expression)
          }
          return next
        }
        return (source) => ts.visitNode(source, visit) as ts.SourceFile
      }] },
    }).outputText
    const nativeRequire = createRequire(file)
    const requireLocal = (id: string) => id.startsWith('.')
      ? load(resolve(dirname(file), id.replace(/\.js$/, '.ts')))
      : nativeRequire(id)
    new Function('module', 'exports', 'require', '__formulaGuardTick', code)(module, module.exports, requireLocal, tick)
    return module.exports
  }
  const root = dirname(fileURLToPath(import.meta.url))
  const Engine = load(resolve(root, 'engine.ts')).FormulaEngine as typeof FormulaEngine
  const registry = load(resolve(root, 'functions/index.ts')).functionRegistry as typeof functionRegistry
  const textFunctions = load(resolve(root, 'functions/text-format.ts')).TEXT_FORMAT_FUNCTIONS as FunctionSpec[]
  const engine = new Engine({ functions: registry(textFunctions), random: () => 0.5, maxWork: 100 })
  engine.setSheets(['Sheet1'])
  return {
    engine,
    run(formula: string) {
      engine.setCell(0, 2, 2, { formula })
      iterations = 0
      tripped = false
      active = true
      const start = performance.now()
      try {
        const result = engine.recalc()
        return { stoppedEarly: result.stoppedEarly, iterations, tripped, ms: performance.now() - start }
      } finally { active = false }
    },
  }
}

const targeted: Record<string, string[]> = {
  WORKDAY: ['1000000,1000000', '1000000,-500000'],
  'WORKDAY.INTL': ['1,300000,"1111110"', '2900000,-300000,"1111110"'],
  NETWORKDAYS: ['0,2958465', '2958465,0'],
  'NETWORKDAYS.INTL': ['0,2958465,"1111110"'],
  RATE: ['1000000,-1,1000000'], IRR: ['{-1,1,-1,1},0.000001'],
  XIRR: ['{-1,1,-1,1},{1,100,10000,2958465},0.000001'],
  PRICE: ['1,2958465,0.05,0.05,100,4'], YIELD: ['1,2958465,0.05,50,100,4'],
  COUPNUM: ['1,2958465,4'], COUPPCD: ['1,2958465,4'], COUPNCD: ['1,2958465,4'],
  COUPDAYS: ['1,2958465,4'], COUPDAYSNC: ['1,2958465,4'], COUPDAYBS: ['1,2958465,4'],
  CUMIPMT: ['0.000001,1000000,100,1,1000000,0'], CUMPRINC: ['0.000001,1000000,100,1,1000000,0'],
  VDB: ['100,1,1000000,0,1000000'], DB: ['100,1,1000000000000,1000000000000'],
  COMBIN: ['1000000000000,500000000000'], PERMUT: ['1000000000000,1000000000000'],
  FACT: ['170'], FACTDOUBLE: ['300'], MULTINOMIAL: ['1000000,1000000'], ROMAN: ['3999'],
  BASE: ['9007199254740991,2,255'], DECIMAL: [`"${'1'.repeat(255)}",2`],
  'BINOM.DIST.RANGE': ['1000000,0.5,0,1000000'],
  'BINOM.INV': ['1000000,0.5,0.5'], 'HYPGEOM.DIST': ['500000,1000000,1000000,2000000,TRUE'],
  'GAMMA.DIST': ['1000000,1000000,1,TRUE'], 'BETA.INV': ['0.5,1000000,1000000'],
  SUBSTITUTE: ['REPT("a",32767),"a","b",1000000000000'],
  REPT: ['"x",1000000000000', '"",1000000000000'],
  NUMBERVALUE: ['"1"&REPT("%",32766)'],
  ARABIC: ['REPT("I",255)'],
  PROPER: ['REPT("a",32767)'],
  TEXTSPLIT: ['REPT("a",32767),"b"'],
  TEXTJOIN: ['"",FALSE,REPT("x",32767),"x"'],
  SEQUENCE: ['1000000', '1000000000000'], RANDARRAY: ['1000000', '1000000000000'],
  MAKEARRAY: ['1000000,1,LAMBDA(r,c,r+c)'],
  MAP: ['A:A,LAMBDA(x,1)'], REDUCE: ['0,A:A,LAMBDA(a,x,a+1)'], SCAN: ['0,A:A,LAMBDA(a,x,a+1)'],
  BYROW: ['A:A,LAMBDA(x,1)'], BYCOL: ['1:1,LAMBDA(x,1)'],
  LET: ['f,LAMBDA(n,IF(n=0,0,f(n-1))),f(1000000000000)'],
  LAMBDA: ['n,n+1'],
  DATEDIF: ['1,2958465,"M"'], EDATE: ['1,1000000000000'], YEARFRAC: ['1,2958465,1'],
}

const functions = functionRegistry(TEXT_FORMAT_FUNCTIONS)
const names = [...new Set([...functions.keys(), ...EVALUATOR_FUNCTIONS])]
let guarded: ReturnType<typeof guardedEngine>

describe('registry-wide adversarial value budget', () => {
  beforeAll(() => { guarded = guardedEngine() })
  it('proves the watchdog detects an uncharged loop', () => {
    // Remove the real budget charge from a copy of SUBSTITUTE, proving this guard catches
    // the exact class of regression even when the interpreter turns the watchdog into #VALUE!.
    const unbudgeted = guardedEngine(true)
    const args = targeted.SUBSTITUTE![0]!
    expect(unbudgeted.run(`SUBSTITUTE(${args})`).tripped).toBe(true)
    expect(guarded.run(`SUBSTITUTE(${args})`).stoppedEarly).toBe(true)
  })
  for (const name of names) {
    it(name, () => {
      const spec = functions.get(name)
      const count = spec ? Math.min(spec.maxArgs, Math.max(spec.minArgs, 8)) : 4
      const cases = new Set(targeted[name] ?? [])
      // Every registry addition is covered automatically, at minimum and optional arities,
      // with each position varied independently and all positions huge together.
      for (const length of new Set([spec?.minArgs ?? 1, count])) {
        for (const value of ['1000000', '1000000000000', '-1000000000000', '1e100', '1e308']) {
          cases.add(Array(length).fill(value).join(','))
          for (let pos = 0; pos < length; pos++) cases.add(Array.from({ length }, (_, i) => i === pos ? value : '1').join(','))
        }
      }
      for (const args of cases) {
        const formula = `${name}(${args})`
        const result = guarded.run(formula)
        expect(result.tripped, `${formula.slice(0, 160)} exceeded ${result.iterations} independent loop iterations`).toBe(false)
        expect(result.stoppedEarly || result.ms < 100, `${name} took ${result.ms}ms`).toBe(true)
      }
    })
  }
})

it('propagates exhausted budgets through nested and lifted calls and lambda combinators', () => {
  for (const formula of [
    'SUM(WORKDAY.INTL(SEQUENCE(500),300000,"1111110"))',
    'CUMIPMT(0.000001,1000000,100,1,1000000,0)',
    'VDB(100,1,1000000,0,1000000)',
    'SUM(MAP(SEQUENCE(10),LAMBDA(x,BINOM.DIST.RANGE(1000000,0.5,0,1000000))))',
    'REDUCE(0,A1:A10000,LAMBDA(a,x,a+1))', 'SCAN(0,A1:A10000,LAMBDA(a,x,a+1))',
    'MAP(A1:A10000,LAMBDA(x,1))', 'BYROW(A1:A10000,LAMBDA(x,1))', 'MAKEARRAY(1000000,1,LAMBDA(r,c,1))',
    'LET(f,LAMBDA(n,IF(n=0,0,f(n-1))),f(1000000000000))',
    'IFERROR(VDB(100,1,1000000,0,1000000),0)',
  ]) {
    const engine = new FormulaEngine({ functions, maxWork: 100 })
    engine.setSheets(['Sheet1'])
    engine.setCell(0, 2, 2, { formula })
    expect(engine.recalc().stoppedEarly, formula).toBe(true)
  }
})
