export { linkMarkdownImages, normalizeMathDelimiters, unwrapBoxedMinipages } from '@pulpo/client-core'

/** Whether the first visible Markdown block is an ATX heading. */
export function beginsWithMarkdownHeading(content: string): boolean {
  return /^(?:[ \t]*\r?\n)*[ \t]{0,3}#{1,6}(?:[ \t]+|$)/.test(content)
}

const SCALED_MARKDOWN_KEYS = new Set(['fontSize', 'lineHeight', 'marginTop', 'marginBottom'])

/** Enlarges every text size (and the spacing that goes with it) by the in-app Text size preference. */
export function scaleMarkdownStyle<T extends object>(style: T, scale: number): T {
  if (scale === 1) return style
  return Object.fromEntries(Object.entries(style).map(([element, values]) => [
    element,
    Object.fromEntries(Object.entries(values as Record<string, unknown>).map(([key, value]) => [
      key,
      SCALED_MARKDOWN_KEYS.has(key) && typeof value === 'number' ? Math.round(value * scale * 10) / 10 : value,
    ])),
  ])) as T
}
