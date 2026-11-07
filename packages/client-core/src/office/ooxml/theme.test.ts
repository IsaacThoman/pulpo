import { describe, expect, it } from 'vitest'
import { LiveFormatError } from '../live-format.js'
import { parseXml } from './package.js'
import {
  DEFAULT_THEME,
  OFFICE_2007_THEME,
  applyExcelTint,
  parseDrawingColor,
  parseTheme,
  presetColorHex,
  resolveDrawingColor,
  resolveSpreadsheetColor,
  resolveThemeFont,
  rgbaToCss,
  type Theme,
} from './theme.js'

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

const THEME_2007 = `<?xml version="1.0"?>
<a:theme ${A} name="Office Theme"><a:themeElements>
<a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>
<a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>
<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>
<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Cambria"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
</a:themeElements></a:theme>`

function color(xml: string, theme: Theme = DEFAULT_THEME): string | undefined {
  const element = parseXml(`<a:solidFill ${A}>${xml}</a:solidFill>`).documentElement!
  const rgba = resolveDrawingColor(element, theme)
  return rgba ? rgbaToCss(rgba) : undefined
}

describe('parseTheme', () => {
  it('reads the color scheme (including sysClr lastClr) and fonts', () => {
    const theme = parseTheme(THEME_2007)
    expect(theme).toEqual(OFFICE_2007_THEME)
  })

  it('keeps fallback slots the file leaves out', () => {
    const theme = parseTheme(`<a:theme ${A}><a:themeElements><a:clrScheme name="x"><a:accent1><a:srgbClr val="112233"/></a:accent1><a:dk1><a:sysClr val="windowText"/></a:dk1></a:clrScheme></a:themeElements></a:theme>`)
    expect(theme.colors.accent1).toBe('112233')
    expect(theme.colors.dk1).toBe('000000')
    expect(theme.colors.accent2).toBe(DEFAULT_THEME.colors.accent2)
    expect(theme.minorFont.latin).toBe('Calibri')
  })

  it('throws LiveFormatError on malformed XML', () => {
    expect(() => parseTheme('<a:theme')).toThrow(LiveFormatError)
  })

  it('resolves theme font references', () => {
    expect(resolveThemeFont('+mn-lt', DEFAULT_THEME)).toBe('Calibri')
    expect(resolveThemeFont('+mj-lt', DEFAULT_THEME)).toBe('Calibri Light')
    expect(resolveThemeFont('Arial', DEFAULT_THEME)).toBe('Arial')
    expect(resolveThemeFont('+mn-ea', DEFAULT_THEME)).toBeUndefined()
  })
})

describe('resolveDrawingColor', () => {
  it('resolves the base color types', () => {
    expect(color('<a:srgbClr val="4472c4"/>')).toBe('#4472c4')
    expect(color('<a:schemeClr val="accent1"/>')).toBe('#4472c4')
    expect(color('<a:schemeClr val="accent1"/>', OFFICE_2007_THEME)).toBe('#4f81bd')
    expect(color('<a:sysClr val="windowText" lastClr="123456"/>')).toBe('#123456')
    expect(color('<a:sysClr val="window"/>')).toBe('#ffffff')
    expect(color('<a:prstClr val="red"/>')).toBe('#ff0000')
    expect(color('<a:prstClr val="dkBlue"/>')).toBe('#00008b')
    expect(color('<a:prstClr val="ltGray"/>')).toBe('#d3d3d3')
    expect(color('<a:scrgbClr r="100000" g="0" b="0"/>')).toBe('#ff0000')
    expect(color('<a:scrgbClr r="21586" g="21586" b="21586"/>')).toBe('#808080')
    expect(color('<a:hslClr hue="14400000" sat="100000" lum="50000"/>')).toBe('#0000ff')
  })

  it('maps tx1/bg1/tx2/bg2 through the color map', () => {
    expect(color('<a:schemeClr val="tx1"/>')).toBe('#000000')
    expect(color('<a:schemeClr val="bg1"/>')).toBe('#ffffff')
    expect(color('<a:schemeClr val="tx2"/>')).toBe('#44546a')
    expect(color('<a:schemeClr val="bg2"/>')).toBe('#e7e6e6')
    const element = parseXml(`<a:schemeClr ${A} val="tx1"/>`).documentElement!
    expect(rgbaToCss(resolveDrawingColor(element, DEFAULT_THEME, { colorMap: { tx1: 'lt1' } })!)).toBe('#ffffff')
  })

  it('applies luminance modifiers like Office chart styles', () => {
    // Office 2013+ chart text, gridlines, and data labels.
    expect(color('<a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr>')).toBe('#595959')
    expect(color('<a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr>')).toBe('#d9d9d9')
    expect(color('<a:schemeClr val="tx1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr>')).toBe('#404040')
    // Seventh series in Office 2013+ colors: accent1 at 60% luminance.
    expect(color('<a:schemeClr val="accent1"><a:lumMod val="60000"/></a:schemeClr>')).toBe('#264478')
  })

  it('applies alpha, saturation, shade, tint, and the rest', () => {
    expect(color('<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>')).toBe('rgba(255,0,0,0.5)')
    expect(color('<a:srgbClr val="FF0000"><a:alpha val="50000"/><a:alphaMod val="50000"/></a:srgbClr>')).toBe('rgba(255,0,0,0.25)')
    expect(color('<a:srgbClr val="BF4040"><a:satMod val="0"/></a:srgbClr>')).toBe('#808080')
    expect(color('<a:srgbClr val="FFFFFF"><a:shade val="50000"/></a:srgbClr>')).toBe('#bcbcbc') // linear-light shade
    expect(color('<a:srgbClr val="000000"><a:tint val="50000"/></a:srgbClr>')).toBe('#bcbcbc')
    expect(color('<a:srgbClr val="FF0000"><a:comp/></a:srgbClr>')).toBe('#00ffff')
    expect(color('<a:srgbClr val="FF0000"><a:inv/></a:srgbClr>')).toBe('#00ffff')
    expect(color('<a:srgbClr val="FF0000"><a:hueOff val="7200000"/></a:srgbClr>')).toBe('#00ff00')
    expect(color('<a:srgbClr val="808080"><a:lum val="100000"/></a:srgbClr>')).toBe('#ffffff')
  })

  it('returns undefined for missing or unknown colors', () => {
    expect(color('')).toBeUndefined()
    expect(color('<a:schemeClr val="nope"/>')).toBeUndefined()
    expect(color('<a:srgbClr val="zzz"/>')).toBeUndefined()
    expect(color('<a:prstClr val="notAColor"/>')).toBeUndefined()
    expect(resolveDrawingColor(undefined, DEFAULT_THEME)).toBeUndefined()
  })

  it('keeps colors parsed once reusable across themes', () => {
    const parsed = parseDrawingColor(parseXml(`<a:solidFill ${A}><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>`).documentElement)!
    expect(parsed).toEqual({ kind: 'scheme', value: 'accent2', modifiers: [{ name: 'lumMod', value: 75000 }] })
    expect(rgbaToCss(resolveDrawingColor(parsed, DEFAULT_THEME)!)).not.toBe(rgbaToCss(resolveDrawingColor(parsed, OFFICE_2007_THEME)!))
  })

  it('knows the preset color names', () => {
    expect(presetColorHex('medSeaGreen')).toBe('3CB371')
    expect(presetColorHex('dkSlateGray')).toBe('2F4F4F')
  })
})

describe('Excel cell tint', () => {
  // Swatches from Excel's theme color picker (Office 2013–2022 theme).
  const LIGHTER_80 = 0.7999816888943144
  const LIGHTER_60 = 0.5999938962981048
  const LIGHTER_40 = 0.3999755851924192
  const DARKER_25 = -0.249977111117893
  const DARKER_50 = -0.499984740745262
  const cases: [string, number, string][] = [
    ['4472C4', LIGHTER_40, '8EA9DB'],
    ['4472C4', DARKER_25, '305496'],
    ['4472C4', DARKER_50, '203764'],
    ['ED7D31', LIGHTER_60, 'F8CBAD'],
    ['ED7D31', DARKER_25, 'C65911'],
    ['ED7D31', DARKER_50, '833C0C'],
    ['70AD47', LIGHTER_80, 'E2EFDA'],
    ['70AD47', LIGHTER_60, 'C6E0B4'],
    ['70AD47', DARKER_25, '548235'],
    ['70AD47', DARKER_50, '375623'],
    ['44546A', LIGHTER_80, 'D6DCE4'],
    ['44546A', LIGHTER_40, '8497B0'],
    ['44546A', DARKER_25, '333F4F'],
    ['44546A', DARKER_50, '222B35'],
    ['E7E6E6', DARKER_25, 'AEAAAA'],
    ['E7E6E6', DARKER_50, '757171'],
    ['FFFFFF', -0.0499893185216834, 'F2F2F2'],
    ['FFFFFF', -0.1499984740745262, 'D9D9D9'],
    ['FFFFFF', DARKER_25, 'BFBFBF'],
    ['FFFFFF', -0.3499862666707358, 'A6A6A6'],
    ['FFFFFF', DARKER_50, '808080'],
    ['000000', 0.499984740745262, '808080'],
    ['000000', 0.3499862666707358, '595959'],
    ['000000', 0.249977111117893, '404040'],
    ['000000', 0.1499984740745262, '262626'],
    ['000000', 0.0499893185216834, '0D0D0D'],
  ]
  it.each(cases)('%s with tint %d is %s', (base, tint, expected) => {
    expect(applyExcelTint(base, tint)).toBe(expected)
  })

  it('leaves untinted colors exactly as they are', () => {
    expect(applyExcelTint('4472C4', 0)).toBe('4472C4')
    expect(applyExcelTint('#123457', 0)).toBe('123457')
  })

  it('reaches black and white at the extremes', () => {
    expect(applyExcelTint('4472C4', -1)).toBe('000000')
    expect(applyExcelTint('4472C4', 1)).toBe('FFFFFF')
  })
})

describe('resolveSpreadsheetColor', () => {
  it('uses Excel theme index order (lt1, dk1, lt2, dk2, accents, links)', () => {
    const slots = Array.from({ length: 12 }, (_, theme) => resolveSpreadsheetColor({ theme }, DEFAULT_THEME))
    expect(slots).toEqual(['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#0563C1', '#954F72'])
    expect(resolveSpreadsheetColor({ theme: 12 }, DEFAULT_THEME)).toBeUndefined()
  })

  it('applies tint to theme colors', () => {
    expect(resolveSpreadsheetColor({ theme: 4, tint: 0.3999755851924192 }, DEFAULT_THEME)).toBe('#8EA9DB')
    expect(resolveSpreadsheetColor({ theme: 0, tint: -0.1499984740745262 }, DEFAULT_THEME)).toBe('#D9D9D9')
  })

  it('reads ARGB values, ignoring alpha', () => {
    expect(resolveSpreadsheetColor({ rgb: 'FF4472C4' }, DEFAULT_THEME)).toBe('#4472C4')
    expect(resolveSpreadsheetColor({ rgb: '00FF0000' }, DEFAULT_THEME)).toBe('#FF0000')
    expect(resolveSpreadsheetColor({ rgb: 'nonsense' }, DEFAULT_THEME)).toBeUndefined()
  })

  it('resolves the legacy indexed palette and system colors', () => {
    expect(resolveSpreadsheetColor({ indexed: 2 }, DEFAULT_THEME)).toBe('#FF0000')
    expect(resolveSpreadsheetColor({ indexed: 10 }, DEFAULT_THEME)).toBe('#FF0000')
    expect(resolveSpreadsheetColor({ indexed: 22 }, DEFAULT_THEME)).toBe('#C0C0C0')
    expect(resolveSpreadsheetColor({ indexed: 63 }, DEFAULT_THEME)).toBe('#333333')
    expect(resolveSpreadsheetColor({ indexed: 64 }, DEFAULT_THEME)).toBe('#000000')
    expect(resolveSpreadsheetColor({ indexed: 65 }, DEFAULT_THEME)).toBe('#FFFFFF')
    expect(resolveSpreadsheetColor({ indexed: 66 }, DEFAULT_THEME)).toBeUndefined()
    expect(resolveSpreadsheetColor({ indexed: 2 }, DEFAULT_THEME, { indexedPalette: ['FF000000', 'FFFFFFFF', 'FF00AA00'] })).toBe('#00AA00')
    expect(resolveSpreadsheetColor({ auto: true }, DEFAULT_THEME)).toBe('#000000')
    expect(resolveSpreadsheetColor({}, DEFAULT_THEME)).toBeUndefined()
  })
})
