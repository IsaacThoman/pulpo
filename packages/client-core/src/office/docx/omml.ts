import type { JmlElement } from './jsonml.js'
import { escapeXmlAttr, escapeXmlText, jmlAttr, jmlChild, stripInvalidXmlChars } from './jsonml.js'

const MAX_DEPTH = 64
const MAX_NODES = 50_000
const MAX_BYTES = 200_000
const MATH_ATTRS = { xmlns: 'http://www.w3.org/1998/Math/MathML' }
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'log', 'lim', 'max', 'min', 'exp', 'ln'])
const PROPERTIES = new Set([
  'm:rPr', 'w:rPr', 'm:fPr', 'm:sSupPr', 'm:sSubPr', 'm:sSubSupPr', 'm:sPrePr',
  'm:radPr', 'm:naryPr', 'm:dPr', 'm:funcPr', 'm:limLowPr', 'm:limUppPr',
  'm:accPr', 'm:barPr', 'm:groupChrPr', 'm:boxPr', 'm:borderBoxPr', 'm:eqArrPr',
  'm:mPr', 'm:mrPr', 'm:phantPr', 'm:oMathParaPr', 'm:argPr', 'm:ctrlPr', 'm:sty',
])

function isElement(value: unknown): value is JmlElement {
  return Array.isArray(value) && typeof value[0] === 'string'
}

function attr(element: JmlElement | undefined, name = 'm:val'): string | undefined {
  if (!element || !element[1] || typeof element[1] !== 'object' || Array.isArray(element[1])) return undefined
  const value = jmlAttr(element, name)
  return typeof value === 'string' ? value : undefined
}

function property(element: JmlElement, group: string, name: string): string | undefined {
  return attr(jmlChild(jmlChild(element, group), name))
}

function enabled(element: JmlElement | undefined): boolean {
  return !!element && !['0', 'false', 'off'].includes(attr(element) ?? '')
}

function hidden(element: JmlElement, group: string, name: string): boolean {
  return enabled(jmlChild(jmlChild(element, group), name))
}

function byteLength(value: string): number {
  let size = 0
  for (const char of value) {
    const code = char.codePointAt(0)!
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return size
}

/** Reserve closing tags before rendering children, so every truncation is well-formed XML. */
class Writer {
  private parts: string[] = []
  private bytes = 0
  private reserved = 0
  stopped = false

  constructor(private readonly xml: boolean) {}

  tag(name: string, attrs: Record<string, string>, body: () => void): void {
    if (this.stopped) return
    const attributes = Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeXmlAttr(value)}"`).join('')
    const open = `<${name}${attributes}>`
    const close = `</${name}>`
    if (this.bytes + this.reserved + byteLength(open) + close.length > MAX_BYTES) {
      this.stopped = true
      return
    }
    this.parts.push(open)
    this.bytes += byteLength(open)
    this.reserved += close.length
    try {
      body()
    } finally {
      this.reserved -= close.length
      this.parts.push(close)
      this.bytes += close.length
    }
  }

  text(value: string): void {
    if (this.stopped) return
    const available = MAX_BYTES - this.bytes - this.reserved
    // Slice before sanitizing: a single hostile run can be much larger than the output budget.
    const clean = stripInvalidXmlChars(value.slice(0, available))
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�')
    let chunk = ''
    for (const char of clean) {
      const escaped = this.xml ? escapeXmlText(char) : char
      const bytes = byteLength(escaped)
      if (this.bytes + this.reserved + bytes > MAX_BYTES) {
        this.stopped = true
        break
      }
      chunk += escaped
      this.bytes += bytes
    }
    this.parts.push(chunk)
    if (value.length > available) this.stopped = true
  }

  finish(): string {
    return this.parts.join('')
  }
}

class Budget {
  private remaining = MAX_NODES

  take(writer?: Writer): boolean {
    if (--this.remaining >= 0) return true
    if (writer) writer.stopped = true
    return false
  }
}

/** jmlText is recursive; this fallback must also work on very deep or cyclic runtime input. */
function plainText(element: JmlElement, budget: Budget): string {
  const result: string[] = []
  const stack: { node: JmlElement; index: number }[] = [{ node: element, index: 2 }]
  let length = 0
  while (stack.length && length < MAX_BYTES && budget.take()) {
    const frame = stack[stack.length - 1]!
    if (frame.index >= frame.node.length) {
      stack.pop()
      continue
    }
    const child: unknown = frame.node[frame.index++]
    if (typeof child === 'string') {
      const part = child.slice(0, MAX_BYTES - length)
      result.push(part)
      length += part.length
    } else if (isElement(child) && !PROPERTIES.has(child[0])) {
      stack.push({ node: child, index: 2 })
    }
  }
  return result.join('')
}

type RunStyle = { normal: boolean; style: string; script: string }

function runStyle(element: JmlElement): RunStyle {
  const props = jmlChild(element, 'm:rPr')
  return {
    normal: element[0] === 'w:r' || enabled(jmlChild(props, 'm:nor')),
    style: attr(jmlChild(props, 'm:sty')) ?? '',
    script: attr(jmlChild(props, 'm:scr')) ?? '',
  }
}

// Unicode math alphabets keep bold/script/fraktur portable without CSS or non-Core variants.
const ALPHABETS: Record<string, readonly [number, number, number?]> = {
  bold: [0x1d400, 0x1d41a, 0x1d7ce],
  italic: [0x1d434, 0x1d44e],
  'bold-italic': [0x1d468, 0x1d482],
  script: [0x1d49c, 0x1d4b6],
  'bold-script': [0x1d4d0, 0x1d4ea],
  fraktur: [0x1d504, 0x1d51e],
  'bold-fraktur': [0x1d56c, 0x1d586],
  'double-struck': [0x1d538, 0x1d552, 0x1d7d8],
  'sans-serif': [0x1d5a0, 0x1d5ba, 0x1d7e2],
  'bold-sans-serif': [0x1d5d4, 0x1d5ee, 0x1d7ec],
  'sans-serif-italic': [0x1d608, 0x1d622],
  'sans-serif-bold-italic': [0x1d63c, 0x1d656],
  monospace: [0x1d670, 0x1d68a, 0x1d7f6],
}
const LETTER_EXCEPTIONS: Record<string, Record<string, string>> = {
  italic: { h: 'ℎ' },
  script: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' },
  fraktur: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' },
  'double-struck': { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' },
}
const GREEK_ALPHABETS: Record<string, readonly [number, number]> = {
  bold: [0x1d6a8, 0x1d6c2],
  italic: [0x1d6e2, 0x1d6fc],
  'bold-italic': [0x1d71c, 0x1d736],
  'bold-sans-serif': [0x1d756, 0x1d770],
  'sans-serif-bold-italic': [0x1d790, 0x1d7aa],
}

function alphabet(style: RunStyle): string {
  const bold = style.style === 'b' || style.style === 'bi'
  const italic = style.style === 'i' || style.style === 'bi'
  switch (style.script) {
    case 'script': return bold ? 'bold-script' : 'script'
    case 'fraktur': return bold ? 'bold-fraktur' : 'fraktur'
    case 'double-struck': return 'double-struck'
    case 'monospace': return 'monospace'
    case 'sans-serif': return italic ? (bold ? 'sans-serif-bold-italic' : 'sans-serif-italic') : (bold ? 'bold-sans-serif' : 'sans-serif')
    default: return bold ? (italic ? 'bold-italic' : 'bold') : (italic ? 'italic' : '')
  }
}

function styledText(value: string, style: RunStyle): string {
  const name = alphabet(style)
  const ranges = ALPHABETS[name]
  if (!ranges) return value
  return Array.from(value, (char) => {
    const exception = LETTER_EXCEPTIONS[name]?.[char]
    if (exception) return exception
    const code = char.codePointAt(0)!
    if (code >= 65 && code <= 90) return String.fromCodePoint(ranges[0] + code - 65)
    if (code >= 97 && code <= 122) return String.fromCodePoint(ranges[1] + code - 97)
    if (code >= 48 && code <= 57 && ranges[2] !== undefined) return String.fromCodePoint(ranges[2] + code - 48)
    const greek = GREEK_ALPHABETS[name]
    if (greek) {
      if (code >= 0x391 && code <= 0x3a9) return String.fromCodePoint(greek[0] + code - 0x391)
      if (code >= 0x3b1 && code <= 0x3c9) return String.fromCodePoint(greek[1] + code - 0x3b1)
      const variant = ['∂', 'ϵ', 'ϑ', 'ϰ', 'ϕ', 'ϱ', 'ϖ'].indexOf(char)
      if (variant >= 0) return String.fromCodePoint(greek[1] + 25 + variant)
      if (char === 'ϴ') return String.fromCodePoint(greek[0] + 17)
    }
    return char
  }).join('')
}

class MathRenderer {
  constructor(private readonly out: Writer, private readonly budget: Budget) {}

  private tag(name: string, body: () => void, attrs: Record<string, string> = {}): void {
    this.out.tag(name, attrs, body)
  }

  private token(name: string, value: string, attrs: Record<string, string> = {}): void {
    this.tag(name, () => this.out.text(value), attrs)
  }

  private children(element: JmlElement, depth: number): void {
    for (let index = 2; index < element.length && !this.out.stopped; index++) {
      if (!this.budget.take(this.out)) break
      const child: unknown = element[index]
      if (typeof child === 'string') this.token('mtext', child)
      else if (isElement(child)) this.render(child, depth + 1)
    }
  }

  private argument(element: JmlElement, name: string, depth: number): void {
    const child = jmlChild(element, name)
    if (child) this.render(child, depth + 1)
    else this.tag('mrow', () => {})
  }

  private run(element: JmlElement): void {
    const style = runStyle(element)
    const text = plainText(element, this.budget)
    if (style.normal) {
      this.token('mtext', text)
      return
    }
    // Letters outside a known function word are separate identifiers, preserving math italics.
    const tokens = text.match(/(?:\d+(?:\.\d+)?|\.\d+)|[\p{L}\p{M}]+|\s+|[^\p{L}\p{M}\d\s]/gu) ?? []
    for (const token of tokens) {
      if (this.out.stopped) break
      if (/^\s/u.test(token)) this.token('mtext', token)
      else if (/^(?:\d|\.\d)/u.test(token)) this.token('mn', styledText(token, style))
      else if (/^[\p{L}\p{M}]/u.test(token)) {
        if (FUNCTIONS.has(token)) this.token('mi', styledText(token, style), { mathvariant: 'normal' })
        else for (const letter of token) {
          this.token('mi', styledText(letter, style), style.style === 'p' || style.style === 'b' || !!style.script ? { mathvariant: 'normal' } : {})
          if (this.out.stopped) break
        }
      } else this.token('mo', token === '-' ? '−' : token)
    }
  }

  private scripts(element: JmlElement, depth: number): void {
    const name = element[0]
    const tag = name === 'm:sSup' ? 'msup' : name === 'm:sSub' ? 'msub' : 'msubsup'
    const slots = name === 'm:sSup' ? ['m:sup'] : name === 'm:sSub' ? ['m:sub'] : ['m:sub', 'm:sup']
    const prescript = name === 'm:sPre'
    const write = () => this.tag(tag, () => {
      if (prescript) this.tag('mrow', () => {})
      else this.argument(element, 'm:e', depth)
      for (const slot of slots) this.argument(element, slot, depth)
    })
    if (prescript) this.tag('mrow', () => { write(); this.argument(element, 'm:e', depth) })
    else write()
  }

  private limits(element: JmlElement, depth: number): void {
    const nary = element[0] === 'm:nary'
    const sub = nary ? !hidden(element, 'm:naryPr', 'm:subHide') : element[0] === 'm:limLow'
    const sup = nary ? !hidden(element, 'm:naryPr', 'm:supHide') : !sub
    const over = !nary || property(element, 'm:naryPr', 'm:limLoc') === 'undOvr'
    const tag = over ? (sub && sup ? 'munderover' : sub ? 'munder' : 'mover') : (sub && sup ? 'msubsup' : sub ? 'msub' : 'msup')
    const base = () => {
      if (nary) this.token('mo', property(element, 'm:naryPr', 'm:chr') ?? '∫')
      else this.argument(element, 'm:e', depth)
    }
    const write = () => {
      if (!sub && !sup) { base(); return }
      this.tag(tag, () => {
        base()
        if (sub) this.argument(element, nary ? 'm:sub' : 'm:lim', depth)
        if (sup) this.argument(element, nary ? 'm:sup' : 'm:lim', depth)
      })
    }
    if (nary) this.tag('mrow', () => { write(); this.argument(element, 'm:e', depth) })
    else write()
  }

  private delimiters(element: JmlElement, depth: number): void {
    this.tag('mrow', () => {
      const begin = property(element, 'm:dPr', 'm:begChr') ?? '('
      const end = property(element, 'm:dPr', 'm:endChr') ?? ')'
      const separator = property(element, 'm:dPr', 'm:sepChr') ?? '|'
      if (begin) this.token('mo', begin, { stretchy: 'true' })
      let first = true
      this.each(element, 'm:e', (child) => {
        if (!first && separator) this.token('mo', separator, { stretchy: 'true' })
        this.render(child, depth + 1)
        first = false
      })
      if (end) this.token('mo', end, { stretchy: 'true' })
    })
  }

  private each(element: JmlElement, name: string, visit: (child: JmlElement) => void): void {
    for (let index = 2; index < element.length && !this.out.stopped; index++) {
      if (!this.budget.take(this.out)) break
      const child: unknown = element[index]
      if (isElement(child) && child[0] === name) visit(child)
    }
  }

  private table(element: JmlElement, depth: number): void {
    this.tag('mtable', () => {
      if (element[0] === 'm:eqArr') {
        this.each(element, 'm:e', (child) => this.tag('mtr', () => this.tag('mtd', () => this.render(child, depth + 1))))
      } else {
        this.each(element, 'm:mr', (row) => this.tag('mtr', () => {
          this.each(row, 'm:e', (cell) => this.tag('mtd', () => this.render(cell, depth + 2)))
        }))
      }
    })
  }

  render(element: JmlElement, depth = 0): void {
    if (this.out.stopped || !this.budget.take(this.out) || PROPERTIES.has(element[0])) return
    if (depth >= MAX_DEPTH) {
      this.token('mtext', plainText(element, this.budget))
      return
    }
    const arg = (name: string) => this.argument(element, name, depth)
    switch (element[0]) {
      case 'm:oMath': this.children(element, depth); return
      case 'm:oMathPara': {
        let first = true
        this.each(element, 'm:oMath', (math) => {
          if (!first) this.tag('mspace', () => {}, { linebreak: 'newline' })
          this.render(math, depth + 1)
          first = false
        })
        return
      }
      case 'm:r': case 'w:r': this.run(element); return
      case 'm:t': case 'w:t': this.token('mtext', plainText(element, this.budget)); return
      case 'm:f': {
        const type = property(element, 'm:fPr', 'm:type')
        if (type === 'lin') this.tag('mrow', () => { arg('m:num'); this.token('mo', '/'); arg('m:den') })
        else this.tag('mfrac', () => { arg('m:num'); arg('m:den') }, type === 'noBar' ? { linethickness: '0' } : {})
        return
      }
      case 'm:sSup': case 'm:sSub': case 'm:sSubSup': case 'm:sPre': this.scripts(element, depth); return
      case 'm:rad': {
        const degree = jmlChild(element, 'm:deg')
        const square = hidden(element, 'm:radPr', 'm:degHide') || !degree || !plainText(degree, this.budget).trim()
        this.tag(square ? 'msqrt' : 'mroot', () => { arg('m:e'); if (!square) arg('m:deg') })
        return
      }
      case 'm:nary': case 'm:limLow': case 'm:limUpp': this.limits(element, depth); return
      case 'm:d': this.delimiters(element, depth); return
      case 'm:func': this.tag('mrow', () => { arg('m:fName'); this.token('mo', '⁡'); arg('m:e') }); return
      case 'm:acc': this.tag('mover', () => {
        arg('m:e'); this.token('mo', property(element, 'm:accPr', 'm:chr') ?? '̂')
      }, { accent: 'true' }); return
      case 'm:bar': {
        const bottom = property(element, 'm:barPr', 'm:pos') === 'bot'
        this.tag(bottom ? 'munder' : 'mover', () => { arg('m:e'); this.token('mo', bottom ? '_' : '¯') }, bottom ? { accentunder: 'true' } : { accent: 'true' })
        return
      }
      case 'm:groupChr': {
        const top = property(element, 'm:groupChrPr', 'm:pos') === 'top'
        this.tag(top ? 'mover' : 'munder', () => {
          arg('m:e'); this.token('mo', property(element, 'm:groupChrPr', 'm:chr') ?? '⏟', { stretchy: 'true' })
        })
        return
      }
      case 'm:eqArr': case 'm:m': this.table(element, depth); return
      case 'm:phant': {
        if (['0', 'false', 'off'].includes(property(element, 'm:phantPr', 'm:show') ?? '')) {
          this.tag('mspace', () => {}, { width: '0' })
        } else this.tag('mrow', () => arg('m:e'))
        return
      }
      default: this.tag('mrow', () => this.children(element, depth))
    }
  }
}

class TextRenderer {
  constructor(private readonly out: Writer, private readonly budget: Budget) {}

  private argument(element: JmlElement, name: string, depth: number): void {
    const child = jmlChild(element, name)
    if (child) this.render(child, depth + 1)
  }

  private fractionArgument(element: JmlElement, name: string, depth: number): void {
    const child = jmlChild(element, name)
    const fragment = new Writer(false)
    if (child) new TextRenderer(fragment, this.budget).render(child, depth + 1)
    const text = fragment.finish()
    this.out.text(/^[\p{L}\p{M}\p{N}.]+$/u.test(text) ? text : `(${text})`)
  }

  private children(element: JmlElement, depth: number, name?: string, separator = ''): void {
    let first = true
    for (let index = 2; index < element.length && !this.out.stopped; index++) {
      if (!this.budget.take(this.out)) break
      const child: unknown = element[index]
      if (name && (!isElement(child) || child[0] !== name)) {
        continue
      }
      if (!first) this.out.text(separator)
      if (typeof child === 'string') this.out.text(child)
      else if (isElement(child)) this.render(child, depth + 1)
      first = false
    }
  }

  render(element: JmlElement, depth = 0): void {
    if (this.out.stopped || !this.budget.take(this.out) || PROPERTIES.has(element[0])) return
    if (depth >= MAX_DEPTH) { this.out.text(plainText(element, this.budget)); return }
    const write = (text: string) => this.out.text(text)
    const arg = (name: string) => this.argument(element, name, depth)
    const script = (marker: string, name: string) => {
      const child = jmlChild(element, name)
      if (!child) return
      const text = plainText(child, this.budget)
      if (!text) return
      write(marker)
      const group = Array.from(text).length > 1
      if (group) write('(')
      arg(name)
      if (group) write(')')
    }
    switch (element[0]) {
      case 'm:r': case 'w:r': case 'm:t': case 'w:t': write(plainText(element, this.budget)); return
      case 'm:oMathPara': this.children(element, depth, 'm:oMath', '\n'); return
      case 'm:f': this.fractionArgument(element, 'm:num', depth); write('/'); this.fractionArgument(element, 'm:den', depth); return
      case 'm:sSup': arg('m:e'); script('^', 'm:sup'); return
      case 'm:sSub': arg('m:e'); script('_', 'm:sub'); return
      case 'm:sSubSup': arg('m:e'); script('_', 'm:sub'); script('^', 'm:sup'); return
      case 'm:sPre': script('_', 'm:sub'); script('^', 'm:sup'); arg('m:e'); return
      case 'm:rad': {
        const degree = jmlChild(element, 'm:deg')
        if (hidden(element, 'm:radPr', 'm:degHide') || !degree || !plainText(degree, this.budget).trim()) write('√(')
        else { write('root('); arg('m:deg'); write(', ') }
        arg('m:e'); write(')'); return
      }
      case 'm:nary':
        write(property(element, 'm:naryPr', 'm:chr') ?? '∫')
        if (!hidden(element, 'm:naryPr', 'm:subHide')) script('_', 'm:sub')
        if (!hidden(element, 'm:naryPr', 'm:supHide')) script('^', 'm:sup')
        write(' '); arg('m:e'); return
      case 'm:d':
        write(property(element, 'm:dPr', 'm:begChr') ?? '(')
        this.children(element, depth, 'm:e', property(element, 'm:dPr', 'm:sepChr') ?? '|')
        write(property(element, 'm:dPr', 'm:endChr') ?? ')'); return
      case 'm:func': arg('m:fName'); write(' '); arg('m:e'); return
      case 'm:limLow': case 'm:limUpp': arg('m:e'); script(element[0] === 'm:limLow' ? '_' : '^', 'm:lim'); return
      case 'm:acc': arg('m:e'); write(property(element, 'm:accPr', 'm:chr') ?? '̂'); return
      case 'm:bar': write(property(element, 'm:barPr', 'm:pos') === 'bot' ? 'underbar(' : 'overbar('); arg('m:e'); write(')'); return
      case 'm:groupChr': arg('m:e'); write(property(element, 'm:groupChrPr', 'm:chr') ?? '⏟'); return
      case 'm:m': write('['); this.children(element, depth, 'm:mr', '; '); write(']'); return
      case 'm:mr': this.children(element, depth, 'm:e', ', '); return
      case 'm:eqArr': this.children(element, depth, 'm:e', '\n'); return
      default: this.children(element, depth)
    }
  }
}

/** MathML for an m:oMath or m:oMathPara element; paragraphs use display mode. */
export function ommlToMathml(element: JmlElement): string {
  let display = false
  try {
    const out = new Writer(true)
    display = isElement(element) && element[0] === 'm:oMathPara'
    const attrs = display ? { ...MATH_ATTRS, display: 'block' } : MATH_ATTRS
    out.tag('math', attrs, () => {
      if (isElement(element)) new MathRenderer(out, new Budget()).render(element)
    })
    return out.finish()
  } catch {
    const out = new Writer(true)
    out.tag('math', display ? { ...MATH_ATTRS, display: 'block' } : MATH_ATTRS, () => out.tag('mtext', {}, () => {
      try { if (isElement(element)) out.text(plainText(element, new Budget())) } catch { /* Malformed accessors must not escape the public boundary. */ }
    }))
    return out.finish()
  }
}

/** Linear plain text for search and agents, with the same work and size bounds as MathML. */
export function ommlToText(element: JmlElement): string {
  const out = new Writer(false)
  try {
    if (isElement(element)) new TextRenderer(out, new Budget()).render(element)
    return out.finish()
  } catch {
    try {
      const fallback = new Writer(false)
      if (isElement(element)) fallback.text(plainText(element, new Budget()))
      return fallback.finish()
    } catch { return '' }
  }
}
