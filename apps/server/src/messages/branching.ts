export interface BranchTurn {
  id: string
  parentResponseId: string | null
  userMessageId?: string | null
  input: unknown
}

export interface BranchMetadata {
  user: { ids: string[]; index: number }
  assistant: { ids: string[]; index: number }
}

function inputSignature(input: unknown): string {
  return JSON.stringify(input)
}

function userBranchKey(turn: BranchTurn): string {
  return turn.userMessageId ?? `legacy:${inputSignature(turn.input)}`
}

/** Build sibling/user groups once, shared by every response in a history payload. */
export function branchMetadataIndex(turns: BranchTurn[]): (active: BranchTurn) => BranchMetadata {
  const parents = new Map<string | null, Map<string, BranchTurn[]>>()
  for (const turn of turns) {
    const groups = parents.get(turn.parentResponseId) ?? new Map<string, BranchTurn[]>()
    const key = userBranchKey(turn)
    const group = groups.get(key) ?? []
    group.push(turn)
    groups.set(key, group)
    parents.set(turn.parentResponseId, groups)
  }
  const indexed = new Map([...parents].map(([parent, groups]) => [parent, {
    keys: new Map([...groups.keys()].map((key, index) => [key, index])),
    userIds: [...groups.values()].map((group) => group.at(-1)!.id),
    groups: new Map([...groups].map(([key, group]) => [key, {
      ids: group.map((turn) => turn.id),
      positions: new Map(group.map((turn, index) => [turn.id, index])),
    }])),
  }]))
  return (active) => {
    const parent = indexed.get(active.parentResponseId)
    const key = userBranchKey(active)
    const group = parent?.groups.get(key)
    const index = parent?.keys.get(key) ?? 0
    const userIds = parent ? [...parent.userIds] : [active.id]
    userIds[index] = active.id
    return {
      user: { ids: userIds, index },
      assistant: { ids: group?.ids ?? [active.id], index: group?.positions.get(active.id) ?? 0 },
    }
  }
}

export function metadataForTurn(turns: BranchTurn[], active: BranchTurn): BranchMetadata {
  return branchMetadataIndex(turns)(active)
}

export function newestDescendantId<T extends Pick<BranchTurn, 'id' | 'parentResponseId'>>(turns: T[], selectedId: string): string {
  const newestChild = new Map(turns.map((turn) => [turn.parentResponseId, turn.id]))
  let leafId = selectedId
  const seen = new Set<string>()
  while (!seen.has(leafId)) {
    seen.add(leafId)
    const child = newestChild.get(leafId)
    if (!child || seen.has(child)) break
    leafId = child
  }
  return leafId
}

function isSameUserVariant(turn: BranchTurn, selected: BranchTurn): boolean {
  return turn.parentResponseId === selected.parentResponseId && userBranchKey(turn) === userBranchKey(selected)
}

/** Response versions are regenerations/edits of one user message; the last one cannot be deleted on its own. */
export function hasOtherResponseVersion(turns: BranchTurn[], selected: BranchTurn): boolean {
  return turns.some((turn) => turn.id !== selected.id && isSameUserVariant(turn, selected))
}

/**
 * Pick the branch to show after a deletion: the neighbouring response version,
 * then another user-message variant, then the parent, following each to its newest leaf.
 */
export function leafAfterDeletion<T extends BranchTurn>(turns: T[], selected: BranchTurn, deleting: Set<string>, currentLeaf: string | null): string | null {
  if (currentLeaf && !deleting.has(currentLeaf)) return currentLeaf
  const remaining = turns.filter((turn) => !deleting.has(turn.id))
  const versions = turns.filter((turn) => isSameUserVariant(turn, selected))
  const position = versions.findIndex((turn) => turn.id === selected.id)
  const neighbour = [...versions.slice(0, Math.max(0, position)).reverse(), ...versions.slice(position + 1)]
    .find((turn) => !deleting.has(turn.id))
  const variant = remaining.filter((turn) => turn.parentResponseId === selected.parentResponseId).at(-1)
  const parent = remaining.find((turn) => turn.id === selected.parentResponseId)
  const anchor = neighbour ?? variant ?? parent
  return anchor ? newestDescendantId(remaining, anchor.id) : remaining.at(-1)?.id ?? null
}

export function cascadeDeletionIds(turns: BranchTurn[], selected: BranchTurn, includeUserVariant: boolean): Set<string> {
  const deleting = new Set(includeUserVariant
    ? turns.filter((turn) => turn.parentResponseId === selected.parentResponseId
      && (selected.userMessageId
        ? turn.userMessageId === selected.userMessageId
        : inputSignature(turn.input) === inputSignature(selected.input)))
      .map((turn) => turn.id)
    : [selected.id])
  let changed = true
  while (changed) {
    changed = false
    for (const turn of turns) {
      if (turn.parentResponseId && deleting.has(turn.parentResponseId) && !deleting.has(turn.id)) {
        deleting.add(turn.id)
        changed = true
      }
    }
  }
  return deleting
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
    lineage.push(turn)
    cursor = turn.parentResponseId
  }
  return lineage.reverse()
}
