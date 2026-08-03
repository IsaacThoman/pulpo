export function reorderList(
  list: string[],
  fromId: string,
  toId: string,
  edge: 'before' | 'after',
): string[] {
  if (fromId === toId) return list
  const next = [...list]
  const from = next.indexOf(fromId)
  if (from < 0 || next.indexOf(toId) < 0) return list
  next.splice(from, 1)
  const to = next.indexOf(toId)
  next.splice(edge === 'before' ? to : to + 1, 0, fromId)
  return next
}

export function resolveOrder(order: string[], available: string[]): string[] {
  const known = new Set(available)
  const ordered = order.filter((item) => known.has(item))
  for (const item of available) {
    if (!ordered.includes(item)) ordered.push(item)
  }
  return ordered
}
