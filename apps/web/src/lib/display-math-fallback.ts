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

const MARKER_CLASS = 'pulpo-display-math'

function isElement(node: HastNode): node is HastElement {
  return node.type === 'element'
}

function hasClass(node: HastNode, className: string): boolean {
  if (!isElement(node)) return false
  const classes = node.properties.className
  return Array.isArray(classes) && classes.includes(className)
}

function textContent(node: HastNode): string {
  if (node.type === 'text') return (node as HastText).value
  return 'children' in node && node.children ? node.children.map(textContent).join('') : ''
}

function isDisplayMath(node: HastNode): node is HastElement {
  if (!isElement(node) || node.tagName !== 'pre') return false
  const [code] = node.children
  return node.children.length === 1 && hasClass(code, 'language-math')
}

function transformChildren(parent: HastParent, transform: (node: HastNode) => HastNode[] | null) {
  parent.children = parent.children.flatMap((child) => {
    const replacement = transform(child)
    if (replacement) return replacement
    if ('children' in child && child.children) transformChildren(child as HastParent, transform)
    return [child]
  })
}

/** Wraps display math before rehype-katex so a failed render can be recognized afterwards. */
export function rehypeMarkDisplayMath() {
  return (tree: HastParent) => transformChildren(tree, (node) => isDisplayMath(node)
    ? [{ type: 'element', tagName: 'div', properties: { className: [MARKER_CLASS], dataSource: textContent(node) }, children: [node] }]
    : null)
}

/** Shows display math KaTeX cannot parse as a LaTeX code block instead of reflowed error-colored source. */
export function rehypeDisplayMathFallback() {
  return (tree: HastParent) => transformChildren(tree, (node) => {
    if (!hasClass(node, MARKER_CLASS)) return null
    const { children, properties } = node as HastElement
    if (!children.some((child) => hasClass(child, 'katex-error'))) return children
    const source = String(properties.dataSource ?? '').trim()
    return [{
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [{ type: 'element', tagName: 'code', properties: { className: ['language-latex'] }, children: [{ type: 'text', value: source }] }],
    }]
  })
}
