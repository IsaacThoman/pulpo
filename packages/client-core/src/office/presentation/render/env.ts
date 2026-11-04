import type { RelTarget } from '../model.js'
import { escapeAttribute, escapeText } from '../xml.js'
import type { ColorContext } from './color.js'
import type { DeckResources, LayoutInfo, MasterInfo, Theme } from './deck.js'

/** EMU per CSS pixel (96 per inch). The renderer lays slides out in pixels at 100% zoom. */
export const EMU_PER_PX = 9525
export const PX_PER_PT = 96 / 72

export const emuToPx = (emu: number | undefined): number => (Number.isFinite(emu) ? (emu as number) / EMU_PER_PX : 0)

/** Visible text the renderer itself produces, so apps can translate it. */
export interface RenderLabels {
  titlePrompt: string
  bodyPrompt: string
  subtitlePrompt: string
  chartUnavailable: string
  mediaPlay: string
}

export const DEFAULT_RENDER_LABELS: RenderLabels = {
  titlePrompt: 'Click to add title',
  bodyPrompt: 'Click to add text',
  subtitlePrompt: 'Click to add subtitle',
  chartUnavailable: 'This chart type cannot be shown',
  mediaPlay: 'Play media',
}

export interface RenderEnv {
  deck: DeckResources
  theme: Theme
  colors: ColorContext
  layout?: LayoutInfo
  master?: MasterInfo
  /** Resolves a relationship id of the part being drawn. */
  rel(id: string): RelTarget | undefined
  /** A URL for an image or media part, or undefined while it is not loaded. */
  assetUrl(partPath: string): string | undefined
  /** Unique ids for SVG definitions within one page. */
  nextId(): string
  slideNumber: number
  /** `edit` shows prompt text in empty placeholders; `view` (thumbnails, present mode) hides them. */
  mode: 'edit' | 'view'
  labels: RenderLabels
  now: Date
}

/** A pixel value for CSS: finite and short. */
export function px(value: number): string {
  return `${Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}px`
}

export function num(value: number): string {
  return String(Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0)
}

export { escapeAttribute, escapeText }

/** A font family list safe to put in a style attribute, with metric-compatible fallbacks. */
export function cssFontFamily(typeface: string | undefined): string {
  const clean = (typeface ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim()
  const fallbacks = FONT_FALLBACKS[clean.toLowerCase()] ?? []
  const generic = /mono|courier|consol/i.test(clean) ? 'monospace' : /times|georgia|cambria|garamond|serif|book|palatino/i.test(clean) && !/sans/i.test(clean) ? 'serif' : 'sans-serif'
  return [...(clean ? [clean] : []), ...fallbacks, generic].map((name) => (name.includes(' ') ? `'${name}'` : name)).join(', ')
}

/** Metric-compatible or look-alike fonts for common Office fonts, tried before the generic family. */
const FONT_FALLBACKS: Record<string, string[]> = {
  calibri: ['Carlito', 'Segoe UI', 'Helvetica Neue', 'Arial'],
  'calibri light': ['Carlito', 'Calibri', 'Segoe UI Light', 'Helvetica Neue', 'Arial'],
  cambria: ['Caladea', 'Georgia', 'Times New Roman'],
  arial: ['Liberation Sans', 'Arimo', 'Helvetica Neue', 'Helvetica'],
  helvetica: ['Arial', 'Liberation Sans', 'Arimo'],
  'times new roman': ['Liberation Serif', 'Tinos', 'Times'],
  'courier new': ['Liberation Mono', 'Cousine', 'Courier'],
  'segoe ui': ['system-ui', 'Helvetica Neue', 'Arial'],
  'segoe ui light': ['Segoe UI', 'system-ui', 'Helvetica Neue'],
  aptos: ['Aptos Display', 'Segoe UI', 'system-ui', 'Helvetica Neue', 'Arial'],
  'aptos display': ['Aptos', 'Segoe UI', 'system-ui', 'Helvetica Neue', 'Arial'],
  'century gothic': ['URW Gothic', 'Avenir Next', 'Futura', 'Arial'],
  'gill sans mt': ['Gill Sans', 'Arial'],
  verdana: ['DejaVu Sans', 'Arial'],
  tahoma: ['DejaVu Sans', 'Verdana', 'Arial'],
  georgia: ['Gelasio', 'Times New Roman'],
  'trebuchet ms': ['Arial'],
  garamond: ['EB Garamond', 'Georgia'],
  consolas: ['Menlo', 'Liberation Mono', 'Courier New'],
  'franklin gothic book': ['Libre Franklin', 'Arial'],
  'tw cen mt': ['Futura', 'Arial'],
  'open sans': ['Arial'],
}
