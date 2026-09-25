import { isValidElement, type ReactElement, type ReactNode } from 'react'

function elementCount(node: ReactNode): number {
  if (Array.isArray(node)) return node.reduce((total: number, child: ReactNode) => total + elementCount(child), 0)
  if (!isValidElement<{ children?: ReactNode }>(node)) return 0
  return 1 + elementCount(node.props.children)
}

/**
 * Reuses immutable rendered elements, evicting the least recently used. The budget counts elements
 * rather than source characters because rendered size varies widely (KaTeX output is far larger than its source).
 */
export function createRenderCache(maxElements: number) {
  const entries = new Map<string, { element: ReactElement; size: number }>()
  let total = 0
  return (key: string, render: () => ReactElement): ReactElement => {
    const cached = entries.get(key)
    if (cached) {
      entries.delete(key)
      entries.set(key, cached)
      return cached.element
    }
    const element = render()
    const size = elementCount(element)
    if (size > maxElements) return element
    entries.set(key, { element, size })
    total += size
    for (const [oldest, entry] of entries) {
      if (total <= maxElements) break
      entries.delete(oldest)
      total -= entry.size
    }
    return element
  }
}
