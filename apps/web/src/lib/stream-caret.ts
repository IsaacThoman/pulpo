interface HastText {
  type: 'text'
  value: string
}

interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: HastNode[]
}

type HastNode = HastText | HastElement | { type: string; children?: HastNode[] }

interface HastParent {
  children: HastNode[]
}

export const STREAM_CARET_CLASS = 'stream-caret'

/** Containers whose trailing text the caret should follow; anything else (links, code, math, rules) gets the caret after it. */
const DESCEND_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'strong', 'em', 'del', 'b', 'i', 's',
])

function isElement(node: HastNode): node is HastElement {
  return node.type === 'element'
}

function isEmptyCell(node: HastElement): boolean {
  return (node.tagName === 'td' || node.tagName === 'th') && !node.children.some(isMeaningful)
}

function isMeaningful(node: HastNode): boolean {
  if (node.type === 'text') return (node as HastText).value.trim() !== ''
  if (!isElement(node)) return false
  // GFM hoists footnote definitions to the end, away from where text is streaming.
  if (node.properties.dataFootnotes) return false
  // GFM pads short table rows with empty cells; the caret belongs after the last typed cell.
  return !isEmptyCell(node)
}

function lastMeaningfulChild(parent: HastParent): HastNode | undefined {
  for (let index = parent.children.length - 1; index >= 0; index -= 1) {
    if (isMeaningful(parent.children[index])) return parent.children[index]
  }
  return undefined
}

function codeBlockChild(node: HastElement): HastElement | undefined {
  if (node.tagName !== 'pre') return undefined
  const [code] = node.children
  return code && isElement(code) && code.tagName === 'code' ? code : undefined
}

/**
 * Places a streaming caret after the last streamed text, descending into lists, tables and quotes
 * so it sits inline instead of on its own line below the final block. Code blocks are flagged with
 * `data-stream-caret` because their renderer draws the caret inside the highlighted code.
 */
export function rehypeStreamCaret() {
  return (tree: HastParent) => {
    let parent = tree
    for (;;) {
      const last = lastMeaningfulChild(parent)
      if (last && isElement(last)) {
        const code = codeBlockChild(last)
        if (code) {
          code.properties.dataStreamCaret = true
          return
        }
        if (DESCEND_TAGS.has(last.tagName)) {
          parent = last
          continue
        }
      }
      break
    }
    parent.children.push({
      type: 'element',
      tagName: 'span',
      properties: { className: [STREAM_CARET_CLASS], ariaHidden: 'true' },
      children: [],
    })
  }
}
