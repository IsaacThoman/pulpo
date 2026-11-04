import type { PresentationController } from '@pulpo/client-core/office/presentation/view'

const DEFAULT_MAP: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }

/** The current slide's theme colors as the color picker shows them (bg1, tx1, …, accent6), as hex. */
export function themeColors(controller: PresentationController): Record<string, string> {
  const deck = controller.deck()
  const slide = controller.state.slide ? controller.slide(controller.state.slide) : undefined
  const layout = slide?.layout ? deck.layout(slide.layout) : undefined
  const master = layout?.master ?? (deck.masterPaths()[0] ? deck.master(deck.masterPaths()[0]!) : undefined)
  const scheme = master?.theme.colors ?? deck.theme(undefined).colors
  const map = { ...DEFAULT_MAP, ...(layout?.colorMap ?? master?.colorMap ?? {}) }
  const colors: Record<string, string> = {}
  for (const slot of ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) colors[slot] = scheme[map[slot] ?? slot] ?? scheme[slot] ?? '000000'
  return colors
}
