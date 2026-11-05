import { hexToRgba, resolveDrawingColor, rgbaToCss, type DrawingColor, type Rgba, type Theme, type ThemeColorSlot } from '../../ooxml/theme.js'
import type { Fill } from './model.js'

/**
 * Automatic colors: what Excel draws for series and points the file does not format, following
 * the chart's `c:style` (Office 2007 styles 1–48) and the Office 2013+ color variations.
 */

const ACCENTS: ThemeColorSlot[] = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']

/** Office 2013+ `colors1.xml` variations, applied to the accent cycle after each 6 series. */
const VARIATIONS: { name: string; value: number }[][] = [
  [],
  [{ name: 'lumMod', value: 60000 }],
  [
    { name: 'lumMod', value: 80000 },
    { name: 'lumOff', value: 20000 },
  ],
  [{ name: 'lumMod', value: 80000 }],
  [
    { name: 'lumMod', value: 60000 },
    { name: 'lumOff', value: 40000 },
  ],
  [{ name: 'lumMod', value: 50000 }],
  [
    { name: 'lumMod', value: 70000 },
    { name: 'lumOff', value: 30000 },
  ],
  [{ name: 'lumMod', value: 70000 }],
  [
    { name: 'lumMod', value: 50000 },
    { name: 'lumOff', value: 50000 },
  ],
]

function scheme(slot: string, modifiers: { name: string; value: number }[] = []): DrawingColor {
  return { kind: 'scheme', value: slot, modifiers }
}

/** The drawing color Excel picks for series (or point) `index` of `count`. */
export function automaticColor(index: number, count: number, style: number): DrawingColor {
  const family = ((Math.max(1, style) - 1) % 8) + 1
  const i = Math.max(0, Math.floor(index))
  if (family === 2) {
    const variation = VARIATIONS[Math.floor(i / ACCENTS.length) % VARIATIONS.length]!
    return scheme(ACCENTS[i % ACCENTS.length]!, variation)
  }
  // Monochrome styles: shades of one color, dark to light across the series.
  const base = family === 1 ? 'tx1' : ACCENTS[family - 3]!
  if (count <= 1) return family === 1 ? scheme('tx1', [{ name: 'lumMod', value: 65000 }, { name: 'lumOff', value: 35000 }]) : scheme(base)
  const position = (i % count) / (count - 1)
  if (family === 1) {
    // Grays from 25% to 85% white.
    const lum = Math.round((0.25 + position * 0.6) * 100000)
    return scheme('tx1', [
      { name: 'lumMod', value: 100000 - lum },
      { name: 'lumOff', value: lum },
    ])
  }
  const shadeTint = position * 1.4 - 0.7
  if (shadeTint < 0) return scheme(base, [{ name: 'shade', value: Math.round((1 + shadeTint) * 100000) }])
  if (shadeTint > 0) return scheme(base, [{ name: 'tint', value: Math.round((1 - shadeTint) * 100000) }])
  return scheme(base)
}

/** True for the dark-background styles (41–48). */
export function isDarkStyle(style: number): boolean {
  return style >= 41 && style <= 48
}

export function resolveColor(color: DrawingColor | undefined, theme: Theme): Rgba | undefined {
  return color ? resolveDrawingColor(color, theme) : undefined
}

/**
 * A fill as one CSS color, or 'none'. Gradients use the average of their stops and patterns their
 * foreground; `fallback` is used for automatic and undrawable fills.
 */
export function fillToCss(fill: Fill | undefined, theme: Theme, fallback: string): string {
  if (!fill) return fallback
  switch (fill.type) {
    case 'none':
      return 'none'
    case 'solid': {
      const rgba = resolveDrawingColor(fill.color, theme)
      return rgba ? rgbaToCss(rgba) : fallback
    }
    case 'gradient': {
      const colors = fill.stops.map((stop) => resolveDrawingColor(stop.color, theme)).filter((c): c is Rgba => !!c)
      if (!colors.length) return fallback
      const avg = (key: keyof Rgba) => colors.reduce((sum, color) => sum + color[key], 0) / colors.length
      return rgbaToCss({ r: avg('r'), g: avg('g'), b: avg('b'), a: avg('a') })
    }
    case 'pattern': {
      const rgba = resolveDrawingColor(fill.foreground ?? fill.background, theme)
      return rgba ? rgbaToCss(rgba) : fallback
    }
    case 'other':
      return fallback
  }
}

export function drawingColorToCss(color: DrawingColor | undefined, theme: Theme, fallback: string): string {
  const rgba = color ? resolveDrawingColor(color, theme) : undefined
  return rgba ? rgbaToCss(rgba) : fallback
}

/** Resolves a hex or drawing color to CSS. */
export function css(color: Rgba | string | undefined, fallback: string): string {
  if (!color) return fallback
  if (typeof color === 'string') {
    const rgba = hexToRgba(color)
    return rgba ? rgbaToCss(rgba) : fallback
  }
  return rgbaToCss(color)
}
