export interface BranchTurn {
  id: string
  parentResponseId: string | null
  input: unknown
}

export interface BranchMetadata {
  user: { ids: string[]; index: number }
  assistant: { ids: string[]; index: number }
}

function inputSignature(input: unknown): string {
  return JSON.stringify(input)
}

export function metadataForTurn(turns: BranchTurn[], active: BranchTurn): BranchMetadata {
  const siblings = turns.filter((turn) => turn.parentResponseId === active.parentResponseId)
  const groups = new Map<string, BranchTurn[]>()
  for (const sibling of siblings) {
    const signature = inputSignature(sibling.input)
    const group = groups.get(signature) ?? []
    group.push(sibling)
    groups.set(signature, group)
  }

  const activeSignature = inputSignature(active.input)
  const userIds = [...groups.entries()].map(([signature, group]) =>
    signature === activeSignature ? active.id : group.at(-1)!.id
  )
  const assistantIds = groups.get(activeSignature)?.map((turn) => turn.id) ?? [active.id]
  return {
    user: { ids: userIds, index: userIds.indexOf(active.id) },
    assistant: { ids: assistantIds, index: assistantIds.indexOf(active.id) },
  }
}

export function newestDescendantId(turns: BranchTurn[], selectedId: string): string {
  let leafId = selectedId
  for (;;) {
    const children = turns.filter((turn) => turn.parentResponseId === leafId)
    const newest = children.at(-1)
    if (!newest) return leafId
    leafId = newest.id
  }
}

export function lineageFromLeaf<T extends BranchTurn>(turns: T[], leafId: string | null): T[] {
  const byId = new Map(turns.map((turn) => [turn.id, turn]))
  const lineage: T[] = []
  const seen = new Set<string>()
  let cursor = leafId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const turn = byId.get(cursor)
    if (!turn) break
    lineage.unshift(turn)
    cursor = turn.parentResponseId
  }
  return lineage
}
