import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { FormulaEngine } from './engine.js'
import { functionRegistry } from './functions/index.js'
import type { FunctionSpec } from './types.js'

/**
 * Independently count loop bodies in a fresh copy of the production interpreter. A missing
 * consumeWork must fail deterministically, even if the loop happens to run quickly on CI.
 * The watchdog also interrupts a regressed/infinite loop before it hangs the test runner.
 * Nothing is instrumented in the shipped engine; imports share this loader's module cache,
 * including CalculationStopped's identity and the synchronous budget state.
 */
export function guardedEngine(options: { omitSubstituteCharge?: boolean; omitShapeCharges?: boolean; maxWork?: number; maxIterations?: number; callbacks?: boolean; unmetered?: boolean; instrument?: boolean } = {}) {
  let active = false, iterations = 0, tripped = false
  const maxIterations = options.maxIterations ?? 2_000
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
    if (options.omitSubstituteCharge && file.endsWith('/functions/text.ts')) source = source.replace('for (let i = 0; i < instance; i++) {\n          consumeWork()', 'for (let i = 0; i < instance; i++) {')
    if (options.omitShapeCharges) source = source.replaceAll('work.consume()', '')
    if (options.unmetered) {
      source = source.replace(/const work = new WorkCounter\(\)\n/g, '').replace(/work\.(consume|flush)\([^)]*\)/g, '')
      if (file.endsWith('/budget.ts')) source = source.replace('  if (remaining === undefined) return', '  return;\n  if (remaining === undefined) return')
    }
    const code = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      transformers: { before: [(context) => {
        const visit: ts.Visitor = (node) => {
          const next = ts.visitEachChild(node, visit, context)
          if (options.instrument !== false && (ts.isForStatement(next) || ts.isForOfStatement(next) || ts.isForInStatement(next) || ts.isWhileStatement(next) || ts.isDoStatement(next))) {
            const body = next.statement
            const tickStatement = ts.factory.createExpressionStatement(ts.factory.createCallExpression(ts.factory.createIdentifier('__formulaGuardTick'), undefined, []))
            const block = ts.factory.createBlock([tickStatement, ...(ts.isBlock(body) ? body.statements : [body])], true)
            if (ts.isForStatement(next)) return ts.factory.updateForStatement(next, next.initializer, next.condition, next.incrementor, block)
            if (ts.isForOfStatement(next)) return ts.factory.updateForOfStatement(next, next.awaitModifier, next.initializer, next.expression, block)
            if (ts.isForInStatement(next)) return ts.factory.updateForInStatement(next, next.initializer, next.expression, block)
            if (ts.isWhileStatement(next)) return ts.factory.updateWhileStatement(next, next.expression, block)
            return ts.factory.updateDoStatement(next, block, next.expression)
          }
          // Native iteration bodies need the watchdog too: database predicates and sorts
          // otherwise hide quadratic work inside callbacks rather than explicit loops.
          if (options.callbacks && (ts.isArrowFunction(next) || ts.isFunctionExpression(next))) {
            const parent = node.parent
            if (parent && ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
              && ['some', 'every', 'find', 'sort', 'map', 'filter', 'reduce', 'forEach', 'from'].includes(parent.expression.name.text)) {
              const tickStatement = ts.factory.createExpressionStatement(ts.factory.createCallExpression(ts.factory.createIdentifier('__formulaGuardTick'), undefined, []))
              const body = ts.isBlock(next.body) ? next.body : ts.factory.createBlock([ts.factory.createReturnStatement(next.body)], true)
              const block = ts.factory.updateBlock(body, [tickStatement, ...body.statements])
              if (ts.isArrowFunction(next)) return ts.factory.updateArrowFunction(next, next.modifiers, next.typeParameters, next.parameters, next.type, next.equalsGreaterThanToken, block)
              return ts.factory.updateFunctionExpression(next, next.modifiers, next.asteriskToken, next.name, next.typeParameters, next.parameters, next.type, block)
            }
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
  const engine = new Engine({ functions: registry(textFunctions), random: () => 0.5, maxWork: options.maxWork ?? 100 })
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

