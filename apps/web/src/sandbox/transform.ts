import { transform } from 'sucrase'

export interface TransformedModule {
  code: string
  imports: string[]
}

// Models often write `React.useState` without importing React; expose it as an implicit global.
const GLOBAL_REACT = /(^|[^\w$.])React\./

/** Compile JSX/TSX module source into CommonJS and report the modules it requires. */
export function transformJsx(source: string): TransformedModule {
  const { code } = transform(source, {
    transforms: ['jsx', 'typescript', 'imports'],
    jsxRuntime: 'automatic',
    production: true,
  })
  const imports = new Set<string>()
  for (const match of code.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)) imports.add(match[2]!)
  if (GLOBAL_REACT.test(code)) imports.add('react')
  return { code, imports: [...imports] }
}

export function evaluateModule(code: string, require: (specifier: string) => unknown): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> }
  const React = GLOBAL_REACT.test(code) ? require('react') : undefined
  const run = new Function('require', 'module', 'exports', 'React', code) as (
    require: (specifier: string) => unknown,
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
    React: unknown,
  ) => void
  run(require, module, module.exports, React)
  return module.exports
}

function isComponent(value: unknown): boolean {
  if (typeof value === 'function') return true
  // memo/forwardRef/lazy components are objects tagged with $$typeof.
  return Boolean(value && typeof value === 'object' && '$$typeof' in value)
}

/** Pick the component to mount: the default export, `App`, or the only exported component. */
export function resolveEntry(exports: Record<string, unknown>): unknown {
  if (isComponent(exports.default)) return exports.default
  if (isComponent(exports.App)) return exports.App
  const components = Object.entries(exports).filter(([name, value]) => /^[A-Z]/.test(name) && isComponent(value))
  if (components.length === 1) return components[0]![1]
  throw new Error('Preview needs a component to render. Add `export default function App() { … }`.')
}

const CLASS_ATTRIBUTE = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`))/g
const STANDALONE_UTILITY = 'flex|grid|block|inline|inline-block|inline-flex|hidden|relative|absolute|fixed|sticky|truncate|italic|underline|uppercase|lowercase|capitalize'
const UTILITY_PREFIX = '[mp][trblxyse]?|gap(?:-[xy])?|space-[xy]|size|w|h|min-w|max-w|min-h|max-h|text|bg|from|via|to|border(?:-[trblxy])?|rounded(?:-[trbl]{1,2})?|shadow|ring|font|leading|tracking|items|justify|self|place-(?:items|content|self)|col-span|row-span|grid-cols|grid-rows|inset(?:-[xy])?|top|left|right|bottom|z|opacity|overflow(?:-[xy])?|object|aspect|basis|grow|shrink|cursor|transition|duration|ease|delay|animate|scale|rotate|translate-[xy]|divide(?:-[xy])?|outline|fill|stroke|decoration|whitespace|line-clamp|backdrop|blur|drop-shadow|select|pointer-events'
// Optional variants (`md:`, `hover:`), then a bare utility (`flex`) or a prefixed one with a value (`p-4`, `bg-[#fff]`).
const UTILITY_CLASS = new RegExp(`^!?(?:[\\w-]+:)*-?(?:(?:${STANDALONE_UTILITY})|(?:${UTILITY_PREFIX})-[\\w./[\\]#%,()-]+)$`)

/** Whether JSX styles itself with Tailwind utility classes, so the preview should load Tailwind's browser build. */
export function usesTailwind(source: string): boolean {
  for (const match of source.matchAll(CLASS_ATTRIBUTE)) {
    const value = match.slice(1).find((group) => group !== undefined) ?? ''
    if (value.split(/\s+/).some((token) => UTILITY_CLASS.test(token))) return true
  }
  return false
}
