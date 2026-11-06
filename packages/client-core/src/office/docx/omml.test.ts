import { describe, expect, it } from 'vitest'
import type { JmlElement } from './jsonml.js'
import { ommlToMathml, ommlToText } from './omml.js'

function el(name: string, attrs: Record<string, string> = {}, ...children: (JmlElement | string)[]): JmlElement {
  return [name, attrs, ...children]
}

const run = (text: string, ...properties: JmlElement[]) => el('m:r', {}, ...(properties.length ? [el('m:rPr', {}, ...properties)] : []), el('m:t', {}, text))
const slot = (name: string, text: string) => el(`m:${name}`, {}, run(text))
const prop = (name: string, value?: string) => el(`m:${name}`, value === undefined ? {} : { 'm:val': value })
const props = (name: string, ...children: JmlElement[]) => el(`m:${name}Pr`, {}, ...children)
const math = (body: string, block = false) => `<math xmlns="http://www.w3.org/1998/Math/MathML"${block ? ' display="block"' : ''}>${body}</math>`
const row = (body: string) => `<mrow>${body}</mrow>`
const mi = (text: string) => `<mi>${text}</mi>`
const mn = (text: string) => `<mn>${text}</mn>`
const mo = (text: string) => `<mo>${text}</mo>`
const convert = (element: JmlElement) => ommlToMathml(el('m:oMath', {}, element))

/** Check closing structure without a DOM (also catches truncation inside an escaped entity). */
function expectBalanced(xml: string): void {
  const stack: string[] = []
  for (const match of xml.matchAll(/<(\/)?([a-z]+)(?:\s[^<>]*)?>/g)) {
    if (match[1]) expect(stack.pop()).toBe(match[2])
    else stack.push(match[2]!)
  }
  expect(stack).toEqual([])
  expect(xml.replace(/&(?:amp|lt|gt|quot|#\d+);/g, '')).not.toContain('&')
  expect(xml.endsWith('</math>')).toBe(true)
}

describe('ommlToMathml', () => {
  it('renders an empty equation', () => {
    expect(convert(el('m:oMath'))).toBe(math(''))
  })

  it('renders a fraction', () => {
    expect(convert(el('m:f', {}, slot('num', 'a'), slot('den', 'b')))).toBe(math(`<mfrac>${row(mi('a'))}${row(mi('b'))}</mfrac>`))
  })

  it('renders a superscript', () => {
    expect(convert(el('m:sSup', {}, slot('e', 'x'), slot('sup', '2')))).toBe(math(`<msup>${row(mi('x'))}${row(mn('2'))}</msup>`))
  })

  it('renders a subscript', () => {
    expect(convert(el('m:sSub', {}, slot('e', 'x'), slot('sub', 'i')))).toBe(math(`<msub>${row(mi('x'))}${row(mi('i'))}</msub>`))
  })

  it('renders combined subscripts and superscripts', () => {
    expect(convert(el('m:sSubSup', {}, slot('e', 'x'), slot('sub', 'i'), slot('sup', '2')))).toBe(math(`<msubsup>${row(mi('x'))}${row(mi('i'))}${row(mn('2'))}</msubsup>`))
  })

  it('renders prescripts before the base using Core elements', () => {
    expect(convert(el('m:sPre', {}, slot('sub', '6'), slot('sup', '14'), slot('e', 'C')))).toBe(math(row(`<msubsup><mrow></mrow>${row(mn('6'))}${row(mn('14'))}</msubsup>${row(mi('C'))}`)))
  })

  it('renders a square root with an empty degree', () => {
    expect(convert(el('m:rad', {}, el('m:deg'), slot('e', 'x')))).toBe(math(`<msqrt>${row(mi('x'))}</msqrt>`))
  })

  it('renders an nth root', () => {
    expect(convert(el('m:rad', {}, slot('deg', '3'), slot('e', 'x')))).toBe(math(`<mroot>${row(mi('x'))}${row(mn('3'))}</mroot>`))
  })

  it('hides a populated root degree when requested', () => {
    expect(convert(el('m:rad', {}, props('rad', prop('degHide')), slot('deg', '3'), slot('e', 'x')))).toBe(math(`<msqrt>${row(mi('x'))}</msqrt>`))
  })

  it('respects an explicitly false degree-hide property', () => {
    expect(convert(el('m:rad', {}, props('rad', prop('degHide', 'false')), slot('deg', '3'), slot('e', 'x')))).toContain('<mroot>')
  })

  it('renders an under/over sum', () => {
    const sum = el('m:nary', {}, props('nary', prop('chr', '∑'), prop('limLoc', 'undOvr')), slot('sub', 'i=1'), slot('sup', 'n'), slot('e', 'i'))
    expect(convert(sum)).toBe(math(row(`<munderover>${mo('∑')}${row(mi('i') + mo('=') + mn('1'))}${row(mi('n'))}</munderover>${row(mi('i'))}`)))
  })

  it('defaults to an integral and renders sub/sup limits', () => {
    const integral = el('m:nary', {}, props('nary', prop('limLoc', 'subSup')), slot('sub', '0'), slot('sup', '1'), slot('e', 'x'))
    expect(convert(integral)).toBe(math(row(`<msubsup>${mo('∫')}${row(mn('0'))}${row(mn('1'))}</msubsup>${row(mi('x'))}`)))
  })

  it('omits hidden n-ary limits', () => {
    const integral = el('m:nary', {}, props('nary', prop('subHide'), prop('supHide', '1')), slot('sub', 'secret'), slot('sup', 'hidden'), slot('e', 'x'))
    expect(convert(integral)).toBe(math(row(mo('∫') + row(mi('x')))))
  })

  it('uses a one-sided limit when only the lower limit is hidden', () => {
    expect(convert(el('m:nary', {}, props('nary', prop('subHide')), slot('sup', '2'), slot('e', 'x')))).toBe(math(row(`<msup>${mo('∫')}${row(mn('2'))}</msup>${row(mi('x'))}`)))
  })

  it('renders delimiters and default separators', () => {
    expect(convert(el('m:d', {}, slot('e', 'a'), slot('e', 'b')))).toBe(math(row(`<mo stretchy="true">(</mo>${row(mi('a'))}<mo stretchy="true">|</mo>${row(mi('b'))}<mo stretchy="true">)</mo>`)))
  })

  it('preserves an explicitly empty opening delimiter', () => {
    expect(convert(el('m:d', {}, props('d', prop('begChr', '')), slot('e', 'x')))).toBe(math(row(`${row(mi('x'))}<mo stretchy="true">)</mo>`)))
  })

  it('supports custom and empty delimiters and separators', () => {
    expect(convert(el('m:d', {}, props('d', prop('begChr', '['), prop('endChr', ''), prop('sepChr', '')), slot('e', 'x'), slot('e', 'y')))).toBe(math(row(`<mo stretchy="true">[</mo>${row(mi('x'))}${row(mi('y'))}`)))
  })

  it('renders sin with invisible function application', () => {
    expect(convert(el('m:func', {}, slot('fName', 'sin'), slot('e', 'x')))).toBe(math(row(`${row('<mi mathvariant="normal">sin</mi>')}${mo('⁡')}${row(mi('x'))}`)))
  })

  it('renders an accent hat', () => {
    expect(convert(el('m:acc', {}, slot('e', 'x')))).toBe(math(`<mover accent="true">${row(mi('x'))}${mo('̂')}</mover>`))
  })

  it('renders a top bar', () => {
    expect(convert(el('m:bar', {}, props('bar', prop('pos', 'top')), slot('e', 'x')))).toBe(math(`<mover accent="true">${row(mi('x'))}${mo('¯')}</mover>`))
  })

  it('renders a bottom bar', () => {
    expect(convert(el('m:bar', {}, props('bar', prop('pos', 'bot')), slot('e', 'x')))).toBe(math(`<munder accentunder="true">${row(mi('x'))}${mo('_')}</munder>`))
  })

  it('defaults a group character to an underbrace', () => {
    expect(convert(el('m:groupChr', {}, slot('e', 'x')))).toBe(math(`<munder>${row(mi('x'))}<mo stretchy="true">⏟</mo></munder>`))
  })

  it('renders a custom group character above its base', () => {
    expect(convert(el('m:groupChr', {}, props('groupChr', prop('pos', 'top'), prop('chr', '⏞')), slot('e', 'x')))).toBe(math(`<mover>${row(mi('x'))}<mo stretchy="true">⏞</mo></mover>`))
  })

  it('renders a 2x2 matrix', () => {
    const matrix = el('m:m', {}, el('m:mr', {}, slot('e', '1'), slot('e', '2')), el('m:mr', {}, slot('e', '3'), slot('e', '4')))
    expect(convert(matrix)).toBe(math(`<mtable><mtr><mtd>${row(mn('1'))}</mtd><mtd>${row(mn('2'))}</mtd></mtr><mtr><mtd>${row(mn('3'))}</mtd><mtd>${row(mn('4'))}</mtd></mtr></mtable>`))
  })

  it('renders an equation array without interpreting alignment text as markup', () => {
    expect(convert(el('m:eqArr', {}, slot('e', 'x&=1'), slot('e', 'y=2')))).toBe(math(`<mtable><mtr><mtd>${row(mi('x') + mo('&amp;') + mo('=') + mn('1'))}</mtd></mtr><mtr><mtd>${row(mi('y') + mo('=') + mn('2'))}</mtd></mtr></mtable>`))
  })

  it('renders lim with n approaching infinity below', () => {
    expect(convert(el('m:limLow', {}, slot('e', 'lim'), slot('lim', 'n→∞')))).toBe(math(`<munder>${row('<mi mathvariant="normal">lim</mi>')}${row(mi('n') + mo('→') + mo('∞'))}</munder>`))
  })

  it('renders upper limits', () => {
    expect(convert(el('m:limUpp', {}, slot('e', 'x'), slot('lim', 'n')))).toBe(math(`<mover>${row(mi('x'))}${row(mi('n'))}</mover>`))
  })

  it('renders normal text and preserves xml:space', () => {
    expect(convert(el('m:r', {}, el('m:rPr', {}, prop('nor')), el('m:t', { 'xml:space': 'preserve' }, ' if x ')))).toBe(math('<mtext> if x </mtext>'))
  })

  it('renders all common function words upright', () => {
    for (const name of ['sin', 'cos', 'log', 'lim', 'max', 'min', 'exp', 'ln']) {
      expect(convert(run(name))).toBe(math(`<mi mathvariant="normal">${name}</mi>`))
    }
  })

  it('tokenizes decimal numbers and identifiers', () => {
    expect(convert(run('12.34+.5xy'))).toBe(math(mn('12.34') + mo('+') + mn('.5') + mi('x') + mi('y')))
  })

  it('maps ASCII minus but leaves asterisk unchanged', () => {
    expect(convert(run('x-y*z'))).toBe(math(mi('x') + mo('−') + mi('y') + mo('*') + mi('z')))
  })

  it('uses upright identifiers for plain style', () => {
    expect(convert(run('x', prop('sty', 'p')))).toBe(math('<mi mathvariant="normal">x</mi>'))
  })

  it('uses Unicode bold, italic, and bold italic alphabets', () => {
    expect(convert(run('A2', prop('sty', 'b')))).toBe(math('<mi mathvariant="normal">𝐀</mi><mn>𝟐</mn>'))
    expect(convert(run('h', prop('sty', 'i')))).toBe(math(mi('ℎ')))
    expect(convert(run('x', prop('sty', 'bi')))).toBe(math(mi('𝒙')))
  })

  it('uses script alphabets, including Unicode letter exceptions', () => {
    expect(convert(run('Bx', prop('scr', 'script')))).toBe(math('<mi mathvariant="normal">ℬ</mi><mi mathvariant="normal">𝓍</mi>'))
    expect(convert(run('R', prop('scr', 'double-struck')))).toBe(math('<mi mathvariant="normal">ℝ</mi>'))
  })

  it('preserves Greek letters when applying bold and italic styles', () => {
    expect(convert(run('Αα', prop('sty', 'b')))).toBe(math('<mi mathvariant="normal">𝚨</mi><mi mathvariant="normal">𝛂</mi>'))
    expect(convert(run('θ', prop('sty', 'bi')))).toBe(math(mi('𝜽')))
  })

  it('ignores Word run properties and treats Word runs as text', () => {
    expect(convert(el('w:r', {}, el('w:rPr', {}, el('w:t', {}, 'hidden')), el('w:t', {}, 'hello x')))).toBe(math('<mtext>hello x</mtext>'))
  })

  it('omits fraction bars and linearizes linear fractions', () => {
    expect(convert(el('m:f', {}, props('f', prop('type', 'noBar')), slot('num', 'a'), slot('den', 'b')))).toBe(math(`<mfrac linethickness="0">${row(mi('a'))}${row(mi('b'))}</mfrac>`))
    expect(convert(el('m:f', {}, props('f', prop('type', 'lin')), slot('num', 'a'), slot('den', 'b')))).toBe(math(row(row(mi('a')) + mo('/') + row(mi('b')))))
  })

  it('approximates skewed fractions with a stacked Core fraction', () => {
    expect(convert(el('m:f', {}, props('f', prop('type', 'skw')), slot('num', 'a'), slot('den', 'b')))).toBe(math(`<mfrac>${row(mi('a'))}${row(mi('b'))}</mfrac>`))
  })

  it('renders box contents without non-Core enclosures', () => {
    for (const name of ['m:box', 'm:borderBox']) {
      expect(convert(el(name, {}, slot('e', 'x')))).toBe(math(row(row(mi('x')))))
    }
  })

  it('uses a zero-width space for hidden phantom content', () => {
    expect(convert(el('m:phant', {}, props('phant', prop('show', '0')), slot('e', 'hidden')))).toBe(math('<mspace width="0"></mspace>'))
    expect(convert(el('m:phant', {}, slot('e', 'x')))).toBe(math(row(row(mi('x')))))
  })

  it('displays multiple equations in a single block math element', () => {
    const para = el('m:oMathPara', {}, el('m:oMath', {}, run('x')), el('m:oMath', {}, run('y')))
    expect(ommlToMathml(para)).toBe(math(`${mi('x')}<mspace linebreak="newline"></mspace>${mi('y')}`, true))
  })

  it('escapes text and never forwards unsafe element names or attributes', () => {
    const input = el('m:unknown', { href: 'javascript:evil()', onclick: 'evil()', style: 'display:none' }, '<&"', el('script', {}, 'alert(1)'))
    expect(convert(input)).toBe(math(row('<mtext>&lt;&amp;"</mtext>' + row('<mtext>alert(1)</mtext>'))))
    expect(convert(input)).not.toMatch(/<script|href=|onclick=|style=/)
  })

  it('escapes delimiter properties instead of interpreting them as XML', () => {
    const output = convert(el('m:d', {}, props('d', prop('begChr', '<&"')), slot('e', 'x')))
    expect(output).toContain('<mo stretchy="true">&lt;&amp;"</mo>')
    expectBalanced(output)
  })

  it('preserves text inside unknown containers', () => {
    expect(convert(el('custom:container', {}, 'hello ', run('x')))).toBe(math(row('<mtext>hello </mtext>' + mi('x'))))
  })

  it('ignores argument, control, and style properties', () => {
    expect(convert(el('m:e', {}, el('m:argPr', {}, 'hidden'), el('m:ctrlPr', {}, 'hidden'), prop('sty', 'b'), run('x')))).toBe(math(row(mi('x'))))
  })

  it('renders missing fraction arguments as empty rows', () => {
    expect(convert(el('m:f'))).toBe(math('<mfrac><mrow></mrow><mrow></mrow></mfrac>'))
  })

  it('tolerates malformed runtime values and missing attribute objects', () => {
    const malformed = ['m:oMath', null, null, 7, ['m:r', null, ['m:t', null, 'x']]] as unknown as JmlElement
    expect(ommlToMathml(malformed)).toBe(math(mi('x')))
    expect(ommlToMathml(null as unknown as JmlElement)).toBe(math(''))
    expect(ommlToText(null as unknown as JmlElement)).toBe('')
  })

  it('falls back to escaped text if malformed properties throw', () => {
    const attrs: Record<string, string> = {}
    Object.defineProperty(attrs, 'm:val', { get() { throw new Error('bad attribute') } })
    expect(convert(el('m:f', {}, props('f', el('m:type', attrs)), slot('num', '<&'), slot('den', 'x')))).toBe(math('<mtext>&lt;&amp;x</mtext>'))
    expect(ommlToMathml(el('m:oMathPara', {}, el('m:oMath', {}, el('m:f', {}, props('f', el('m:type', attrs)), slot('num', 'x')))))).toBe(math('<mtext>x</mtext>', true))
  })

  it('handles 10,000 levels without recursive fallback overflow', () => {
    let input = run('x')
    for (let index = 0; index < 10_000; index++) input = el('unknown', {}, input)
    const output = convert(input)
    expect(output).toContain('<mtext>x</mtext>')
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(200_000)
    expectBalanced(output)
    expect(ommlToText(input)).toBe('x')
  })

  it('bounds cyclic and very wide inputs', () => {
    const cyclic = el('unknown')
    cyclic.push(cyclic)
    const cycleOutput = convert(cyclic)
    expectBalanced(cycleOutput)
    expect(ommlToText(cyclic).length).toBeLessThanOrEqual(200_000)
    const wide = el('m:oMath')
    for (let index = 0; index < 60_000; index++) wide.push('')
    expect(Buffer.byteLength(ommlToMathml(wide))).toBeLessThanOrEqual(200_000)
    expect(ommlToText(wide)).toBe('')
  })

  it('bounds bytes and closes tags when truncating escaped multibyte text', () => {
    const output = convert(run('😀<&'.repeat(100_000), prop('nor')))
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(200_000)
    expectBalanced(output)
    expect(output).toContain('😀&lt;&amp;')
    expect(Buffer.byteLength(ommlToText(run('😀'.repeat(100_000))))).toBeLessThanOrEqual(200_000)
  })

  it('bounds output when many individual tags exhaust the remaining space', () => {
    const output = convert(run('x+'.repeat(100_000)))
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(200_000)
    expectBalanced(output)
  })

  it('removes invalid XML controls and repairs lone surrogates', () => {
    expect(convert(run('a\u0000\ud800', prop('nor')))).toBe(math('<mtext>a�</mtext>'))
  })
})

describe('ommlToText', () => {
  it('renders a linear fraction with precedence', () => {
    expect(ommlToText(el('m:f', {}, slot('num', 'a+b'), slot('den', 'c')))).toBe('(a+b)/c')
    expect(ommlToText(el('m:f', {}, slot('num', 'a'), slot('den', 'b+c')))).toBe('a/(b+c)')
  })

  it('renders scripts and roots', () => {
    expect(ommlToText(el('m:sSup', {}, slot('e', 'x'), slot('sup', '2')))).toBe('x^2')
    expect(ommlToText(el('m:sSubSup', {}, slot('e', 'x'), slot('sub', 'i+1'), slot('sup', 'n')))).toBe('x_(i+1)^n')
    expect(ommlToText(el('m:rad', {}, slot('e', 'x')))).toBe('√(x)')
    expect(ommlToText(el('m:rad', {}, slot('deg', '3'), slot('e', 'x')))).toBe('root(3, x)')
  })

  it('renders a sum with its limits', () => {
    expect(ommlToText(el('m:nary', {}, props('nary', prop('chr', '∑')), slot('sub', 'i=1'), slot('sup', 'n'), slot('e', 'i')))).toBe('∑_(i=1)^n i')
  })

  it('renders functions, limits, delimiters, and multiline paragraphs', () => {
    expect(ommlToText(el('m:func', {}, slot('fName', 'sin'), slot('e', 'x')))).toBe('sin x')
    expect(ommlToText(el('m:limLow', {}, slot('e', 'lim'), slot('lim', 'n→∞')))).toBe('lim_(n→∞)')
    expect(ommlToText(el('m:d', {}, slot('e', 'x'), slot('e', 'y')))).toBe('(x|y)')
    expect(ommlToText(el('m:oMathPara', {}, el('m:oMath', {}, run('x')), el('m:oMath', {}, run('y'))))).toBe('x\ny')
  })

  it('renders matrix cells and equation array rows with separators', () => {
    expect(ommlToText(el('m:m', {}, el('m:mr', {}, slot('e', 'a'), slot('e', 'b')), el('m:mr', {}, slot('e', 'c'), slot('e', 'd'))))).toBe('[a, b; c, d]')
    expect(ommlToText(el('m:eqArr', {}, slot('e', 'a=1'), slot('e', 'b=2')))).toBe('a=1\nb=2')
  })

  it('keeps phantom content searchable and plain text unescaped', () => {
    expect(ommlToText(el('m:phant', {}, props('phant', prop('show', '0')), slot('e', 'secret')))).toBe('secret')
    expect(ommlToText(run('<&"'))).toBe('<&"')
  })
})
