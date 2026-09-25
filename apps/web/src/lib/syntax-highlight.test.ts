import { describe, expect, it } from 'vitest'
import type { Element, Root, RootContent } from 'hast'
import {
  MAX_AUTO_HIGHLIGHT_CHARACTERS,
  MAX_HIGHLIGHT_CHARACTERS,
  highlightTree,
  languageForFile,
  languageForPreviewKind,
  normalizeLanguage,
} from './syntax-highlight'

function tokenClasses(tree: Root | null): string[] {
  const classes: string[] = []
  const visit = (node: Root | RootContent) => {
    if (node.type === 'element') classes.push(...((node as Element).properties.className as string[] ?? []))
    if ('children' in node) node.children.forEach(visit)
  }
  if (tree) visit(tree)
  return classes
}

describe('normalizeLanguage', () => {
  it.each([
    ['ts', 'ts'],
    ['TSX', 'tsx'],
    ['c++', 'c++'],
    ['C#', 'csharp'],
    ['objective-c', 'objectivec'],
    ['sh', 'sh'],
    ['react', 'javascript'],
    ['vue', 'xml'],
    ['toml', 'ini'],
    ['text', null],
    ['latex', null],
    ['', null],
    [undefined, null],
  ])('%s -> %s', (tag, expected) => {
    expect(normalizeLanguage(tag)).toBe(expected)
  })
})

describe('languageForFile', () => {
  it.each([
    ['main.py', '', 'python'],
    ['App.TSX', '', 'typescript'],
    ['config.yml', '', 'yaml'],
    ['index.html', '', 'xml'],
    ['Cargo.toml', '', 'ini'],
    ['notes.txt', 'text/plain', null],
    ['server.log', '', null],
    ['data', 'application/json', 'json'],
    ['feed', 'application/atom+xml', 'xml'],
    ['payload', 'application/vnd.api+json; charset=utf-8', 'json'],
  ])('%s (%s) -> %s', (name, mime, expected) => {
    expect(languageForFile(name, mime)).toBe(expected)
  })
})

describe('languageForPreviewKind', () => {
  it('maps sandbox kinds to grammars', () => {
    expect(languageForPreviewKind('html')).toBe('xml')
    expect(languageForPreviewKind('svg')).toBe('xml')
    expect(languageForPreviewKind('jsx')).toBe('javascript')
  })
})

describe('highlightTree', () => {
  it('tokenizes a known language', () => {
    const classes = tokenClasses(highlightTree('const answer = 42 // why', 'ts'))
    expect(classes).toContain('hljs-keyword')
    expect(classes).toContain('hljs-number')
    expect(classes).toContain('hljs-comment')
  })

  it('guesses untagged code', () => {
    const code = 'def greet(name):\n    """Say hi."""\n    return f"hello {name}"\n\nif __name__ == "__main__":\n    print(greet("pulpo"))'
    expect(highlightTree(code)?.data?.language).toBe('python')
    expect(highlightTree(code, '')?.data?.language).toBe('python')
  })

  it('leaves plain, unknown and unconvincing input as text', () => {
    expect(highlightTree('const x = 1', null)).toBeNull()
    expect(highlightTree('const x = 1', 'latex')).toBeNull()
    expect(highlightTree('just some words')).toBeNull()
    expect(highlightTree('')).toBeNull()
  })

  it('skips oversized input', () => {
    expect(highlightTree('x'.repeat(MAX_HIGHLIGHT_CHARACTERS + 1), 'js')).toBeNull()
    expect(highlightTree('let x = 1\n'.repeat(MAX_AUTO_HIGHLIGHT_CHARACTERS / 10 + 1))).toBeNull()
  })
})
