import { describe, expect, it } from 'vitest'
import { cssString, fontStack, latinFont, runPropertiesCss, cssText, type ThemeInfo } from './css.js'
import { packJml } from './jsonml.js'
import { StyleSheet } from './styles.js'
import { documentStylesheet, themeVariables } from './view/stylesheet.js'

/** Whether CSS outside its quoted strings opens a rule, loads something, or ends the style sheet. */
const escapes = (css: string) => /[{}]|url\(|<\/?style|@import/i.test(css.replace(/"[^"]*"/g, '""'))

describe('CSS from document values', () => {
  it('ignores theme color names a file makes up', () => {
    const evil = 'x)}body{background:url(https://attacker.example/leak)!important}.q{color:var(--z'
    const css = cssText(runPropertiesCss(['w:rPr', {}, ['w:color', { 'w:val': 'auto', 'w:themeColor': evil }], ['w:shd', { 'w:fill': 'auto', 'w:themeFill': 'q);background-image:url(https://a.example)' }]]))
    expect(escapes(css)).toBe(false)
    // Real theme colors still resolve, to the theme or to its variable.
    expect(cssText(runPropertiesCss(['w:rPr', {}, ['w:color', { 'w:themeColor': 'accent1' }]]))).toContain('var(--docx-theme-accent1)')
  })

  it('keeps font names inside their CSS string', () => {
    for (const name of ['A"}body{color:red}', 'A\\"}x{', 'A\n}body{x:y', 'A</style><script>']) {
      const stack = fontStack(name)
      expect(stack.startsWith(cssString(name))).toBe(true)
      expect(cssString(name).slice(1, -1)).not.toMatch(/["\\\n<>]/)
    }
    // A font named like the theme fallback variable is just a name.
    const css = cssText(runPropertiesCss(['w:rPr', {}, ['w:rFonts', { 'w:ascii': 'var(--x);background:url(https://a.example)' }]]))
    expect(css).toMatch(/font-family:"var\(--x\)/)
    expect(latinFont(['w:rFonts', { 'w:asciiTheme': 'majorHAnsi' }])).toBe('var(--docx-font-major)')
  })

  it('writes only names and hex colors from a theme, wherever it came from', () => {
    const theme: ThemeInfo = {
      colors: { accent1: '#112233', 'x:1}body{a': '#000000', accent2: 'red;}body{x:y' },
      fonts: { major: 'Evil"}body{color:red}', minor: 'Calibri' },
    }
    const vars = themeVariables(theme)
    expect(vars).toContain('--docx-theme-accent1:#112233')
    expect(escapes(vars)).toBe(false)
    const sheet = new StyleSheet([['docDefaults', packJml(['w:docDefaults', {}, ['w:rPrDefault', {}, ['w:rPr', {}, ['w:color', { 'w:val': 'auto', 'w:themeColor': 'x)}body{color:red}.q{color:var(--z' }]]]])]])
    const css = documentStylesheet('docx-scope-test', sheet, theme)
    expect(css.replace(/"[^"]*"/g, '""')).not.toMatch(/body\{/)
  })
})
