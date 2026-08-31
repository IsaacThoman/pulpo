export { normalizeMathDelimiters } from '@pulpo/client-core'

/** Whether the first visible Markdown block is an ATX heading. */
export function beginsWithMarkdownHeading(content: string): boolean {
  return /^(?:[ \t]*\r?\n)*[ \t]{0,3}#{1,6}(?:[ \t]+|$)/.test(content)
}
