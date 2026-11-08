import { ui } from '@/i18n/ui'
import type { MenuEntry } from './menu'

/** Docs' and Office's zoom presets (1 = 100%). */
export const ZOOM_PRESETS: readonly number[] = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2]

export interface ZoomOptions {
  zoom: number
  onZoom: (zoom: number) => void
  presets?: readonly number[]
  /** − and + change the zoom by this much (0.1 is 10 points). */
  step?: number
  min?: number
  max?: number
  /** Whether the view is fitted to the window; with `onFit` the list offers Fit. */
  fitted?: boolean
  onFit?: () => void
}

export const nearZoom = (a: number, b: number) => Math.abs(a - b) < 0.001

/** The zoom after one step of − or +, within bounds, on whole percents. */
export function steppedZoom(zoom: number, direction: 1 | -1, { step = 0.1, min = 0.25, max = 4 }: Pick<ZoomOptions, 'step' | 'min' | 'max'> = {}): number {
  return Math.min(max, Math.max(min, Math.round((zoom + direction * step) * 100) / 100))
}

export const zoomPercent = (zoom: number) => `${Math.round(zoom * 100)}%`

/**
 * View ▸ Zoom for a menu bar: the presets (and Fit) as choices, the current one checked. Build it
 * when the menu opens.
 */
export function zoomMenu({ zoom, onZoom, presets = ZOOM_PRESETS, fitted, onFit }: ZoomOptions): MenuEntry {
  return {
    type: 'submenu',
    id: 'zoom',
    label: ui("Zoom"),
    items: [
      ...(onFit ? [{ type: 'item', id: 'zoom-fit', label: ui("Fit"), radio: true, checked: Boolean(fitted), onSelect: onFit } satisfies MenuEntry, { type: 'separator' } satisfies MenuEntry] : []),
      ...presets.map((preset): MenuEntry => ({ type: 'item', id: `zoom-${Math.round(preset * 100)}`, label: zoomPercent(preset), radio: true, checked: !fitted && nearZoom(zoom, preset), onSelect: () => onZoom(preset) })),
    ],
  }
}
