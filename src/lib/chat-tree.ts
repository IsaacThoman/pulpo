export interface ChatTreeNode {
  id: string
  parentResponseId: string | null
}

/** Return the selected root-to-leaf path from a complete, ordered response tree. */
export function lineageFromLeaf<T extends ChatTreeNode>(nodes: T[], leafId: string | null): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const lineage: T[] = []
  const seen = new Set<string>()
  let cursor = leafId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const node = byId.get(cursor)
    if (!node) break
    lineage.unshift(node)
    cursor = node.parentResponseId
  }
  return lineage
}

/** Match the server's branch activation rule: continue through the newest descendants. */
export function newestDescendantId<T extends ChatTreeNode>(nodes: T[], selectedId: string): string {
  let leafId = selectedId
  for (;;) {
    const children = nodes.filter((node) => node.parentResponseId === leafId)
    const newest = children.at(-1)
    if (!newest) return leafId
    leafId = newest.id
  }
}
