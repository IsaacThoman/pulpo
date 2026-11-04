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

/** Media types the views may hand to the browser as object URLs: images and media it plays natively. */
const DISPLAYABLE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg'])

/**
 * How a view may show an asset: as an object URL of a known raster or media type, as a data URL
 * for SVG (which top-level navigation refuses, so "open image in new tab" cannot run its
 * scripts with the app's origin), or not at all. Anything else a file declares (HTML, unknown
 * types) is never turned into a URL.
 */
export function displayableMediaType(mimeType: string): 'blob' | 'svg' | undefined {
  const type = mimeType.toLowerCase().split(';')[0]!.trim()
  if (type === 'image/svg+xml') return 'svg'
  return DISPLAYABLE_MEDIA.has(type) ? 'blob' : undefined
}

/** An object or data URL for an asset's bytes, or undefined when it must not be shown. */
export function assetObjectUrl(bytes: Uint8Array, mimeType: string): string | undefined {
  const kind = displayableMediaType(mimeType)
  if (kind === 'svg') {
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    return `data:image/svg+xml;base64,${btoa(binary)}`
  }
  if (kind === 'blob') return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType.toLowerCase().split(';')[0]!.trim() }))
  return undefined
}
