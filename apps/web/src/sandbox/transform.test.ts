import { readFileSync } from 'node:fs'
import { createElement, type ComponentType } from 'react'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { loadSandboxModules, UnsupportedImportError } from './modules'
import { evaluateModule, resolveEntry, transformJsx, usesTailwind } from './transform'

const modules: Record<string, unknown> = { react: React, 'react/jsx-runtime': jsxRuntime }
const requireModule = (specifier: string) => {
  if (!(specifier in modules)) throw new Error(`missing ${specifier}`)
  return modules[specifier]
}
const mains = readFileSync(new URL('./fixtures/mains.jsx', import.meta.url), 'utf8')

describe('transformJsx', () => {
  it('compiles a real model-written component and only needs React', () => {
    const compiled = transformJsx(mains)
    expect(compiled.imports.sort()).toEqual(['react', 'react/jsx-runtime'])

    const App = resolveEntry(evaluateModule(compiled.code, requireModule)) as ComponentType
    expect(App).toBeTypeOf('function')
    const markup = renderToStaticMarkup(createElement(App))
    expect(markup).toContain('Mains')
    expect(markup).toContain('Circuit 1')
    expect(markup.match(/aria-label="Fitting, row/g)).toHaveLength(9)
  })

  it('reports only the libraries a snippet imports', () => {
    expect(transformJsx(`import { LineChart } from 'recharts'\nexport default () => <LineChart />`).imports.sort())
      .toEqual(['react/jsx-runtime', 'recharts'])
    expect(transformJsx(`import { Zap } from "lucide-react"\nexport default function A() { return <Zap /> }`).imports)
      .toContain('lucide-react')
  })

  it('supports TypeScript syntax and an implicit React global', () => {
    const compiled = transformJsx(`
      type Props = { label: string }
      export default function Counter({ label = 'Count' }: Partial<Props>) {
        const [count] = React.useState<number>(2)
        return <p>{label}: {count}</p>
      }
    `)
    expect(compiled.imports).toContain('react')
    const App = resolveEntry(evaluateModule(compiled.code, requireModule)) as ComponentType
    expect(renderToStaticMarkup(createElement(App))).toBe('<p>Count: 2</p>')
  })
})

describe('resolveEntry', () => {
  const Component = () => null
  it('prefers the default export, then App, then a single exported component', () => {
    expect(resolveEntry({ default: Component, App: () => null })).toBe(Component)
    expect(resolveEntry({ App: Component, helper: 1 })).toBe(Component)
    expect(resolveEntry({ Dashboard: Component, format: () => '' })).toBe(Component)
  })

  it('explains how to fix a module without a component', () => {
    expect(() => resolveEntry({ value: 1 })).toThrow(/export default function App/)
    expect(() => resolveEntry({ One: Component, Two: Component })).toThrow(/export default/)
  })
})

describe('usesTailwind', () => {
  it.each([
    ['<div className="flex items-center gap-4 p-6">', true],
    ['<div className={`grid md:grid-cols-2 bg-slate-900`}>', true],
    ["<p className='text-sm hover:text-[#f00]'>", true],
    ['<button className="cell">', false],
    ['<main className="content list">', false],
    ['<div style={{ display: "flex" }}>', false],
  ])('detects utilities in %s', (source, expected) => {
    expect(usesTailwind(source)).toBe(expected)
  })

  it('does not load Tailwind for the Mains example', () => {
    expect(usesTailwind(mains)).toBe(false)
  })
})

describe('loadSandboxModules', () => {
  it('rejects libraries previews do not provide', async () => {
    await expect(loadSandboxModules(['react', 'axios'])).rejects.toBeInstanceOf(UnsupportedImportError)
    await expect(loadSandboxModules(['axios'])).rejects.toThrow(/"axios" isn't available in previews/)
  })

  it('explains that sibling modules cannot be loaded', async () => {
    await expect(loadSandboxModules(['./Card.jsx'])).rejects.toThrow(/Previews run a single file, so "\.\/Card\.jsx" can't be loaded/)
  })

  it('resolves stylesheet imports to empty modules so the preview still renders', async () => {
    const modules = await loadSandboxModules(['./styles.css', '../theme.module.scss'])
    expect(modules.get('./styles.css')).toEqual({})
    expect(modules.get('../theme.module.scss')).toEqual({})

    const compiled = transformJsx(`import './styles.css'
import classes from './App.module.css'
export default function App() { return <main className={classes.app}>Flashcards</main> }`)
    expect(compiled.imports).toEqual(expect.arrayContaining(['./styles.css', './App.module.css']))
    const App = resolveEntry(evaluateModule(compiled.code, (specifier) => specifier.endsWith('.css') ? {} : requireModule(specifier))) as ComponentType
    expect(renderToStaticMarkup(createElement(App))).toBe('<main>Flashcards</main>')
  })
})
