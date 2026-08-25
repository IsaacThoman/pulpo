import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import esUi from './locales/es-ES-ui'

const sourceRoot = resolve(import.meta.dirname, '..')
const visibleAttributes = new Set([
  'alt', 'aria-label', 'cancelLabel', 'confirmLabel', 'description',
  'emptyText', 'label', 'placeholder', 'title',
])

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    if (statSync(path).isDirectory()) {
      if (path.includes('/components/ui') || path.includes('/i18n')) return []
      return sourceFiles(path)
    }
    return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
  })
}

function templateKey(template: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text
  return template.head.text + template.templateSpans
    .map((span, index) => `{{${index}}}${span.literal.text}`)
    .join('')
}

describe('web localization coverage', () => {
  it('has Spanish copy and matching placeholders for every source-keyed translation', () => {
    const keys = new Set<string>()
    for (const path of sourceFiles()) {
      const source = readFileSync(path, 'utf8')
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ui') {
          const [argument] = node.arguments
          if (argument && ts.isStringLiteralLike(argument)) keys.add(argument.text)
        }
        if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'uit') {
          keys.add(templateKey(node.template))
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }

    const missing = [...keys].filter((key) => !(key in esUi))
    const placeholderMismatches = [...keys].filter((key) => {
      const placeholders = (value: string) => [...value.matchAll(/{{\s*([^}\s]+)\s*}}/g)].map((match) => match[1]).sort()
      return JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(esUi[key] ?? ''))
    })
    expect(missing).toEqual([])
    expect(placeholderMismatches).toEqual([])
  })

  it('does not leave application-authored JSX copy outside localization', () => {
    const untranslated: string[] = []
    for (const path of sourceFiles()) {
      if (!path.endsWith('.tsx')) continue
      const source = readFileSync(path, 'utf8')
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text) && node.text.trim() !== 'Pulpo') {
          untranslated.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.text.trim()}`)
        }
        if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && visibleAttributes.has(node.name.text) && node.initializer && ts.isStringLiteral(node.initializer)) {
          const value = node.initializer.text
          if (/[A-Za-z]/.test(value) && value !== 'Pulpo' && !/^https?:/.test(value)) {
            untranslated.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${value}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    expect(untranslated).toEqual([])
  })
})
