const INDENT = 16
const MAX_INDENT = 64

/** Keep room for a readable, tappable row even at the server's maximum tree depth. */
export function sidebarIndent(depth: number): number {
  return Math.min(Math.max(depth, 0) * INDENT, MAX_INDENT)
}
