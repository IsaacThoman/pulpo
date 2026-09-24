import type { Message } from './types'

interface BranchResponse {
  id: string
  parentResponseId: string | null
  userMessageId: string | null
  input: unknown[]
  createdAt: string
  branches: {
    user: NonNullable<Message['branch']>
    assistant: NonNullable<Message['branch']>
  }
}

export function hasMultipleBranches(branch: Message['branch']): boolean {
  return (branch?.ids.length ?? 0) > 1
}

function compareResponses(a: BranchResponse, b: BranchResponse): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function userBranchKey(response: BranchResponse): string {
  return response.userMessageId ?? `legacy:${JSON.stringify(response.input)}`
}

export function withBranchMetadata<T extends BranchResponse>(input: T[]): T[] {
  const responses = [...input].sort(compareResponses)
  return responses.map((active) => {
    const siblings = responses.filter((response) => response.parentResponseId === active.parentResponseId)
    const groups = new Map<string, T[]>()
    for (const sibling of siblings) {
      const key = userBranchKey(sibling)
      groups.set(key, [...(groups.get(key) ?? []), sibling])
    }
    const activeKey = userBranchKey(active)
    const userIds = [...groups.entries()].map(([key, group]) => key === activeKey ? active.id : group.at(-1)!.id)
    const assistantIds = groups.get(activeKey)?.map((response) => response.id) ?? [active.id]
    return {
      ...active,
      branches: {
        user: { ids: userIds, index: userIds.indexOf(active.id) },
        assistant: { ids: assistantIds, index: assistantIds.indexOf(active.id) },
      },
    }
  })
}

type Branch = NonNullable<Message['branch']>

function branchAt(ids: string[], id: string): Branch {
  return { ids, index: Math.max(0, ids.indexOf(id)) }
}

/**
 * Add a local response while keeping server branch metadata. Web history holds
 * only the active lineage, so recomputing from cached rows would drop every
 * sibling outside the loaded page.
 */
export function withInsertedBranchResponse<T extends BranchResponse>(input: T[], inserted: T): T[] {
  const responses = input.filter((response) => response.id !== inserted.id)
  const key = userBranchKey(inserted)
  const siblings = responses.filter((response) => response.parentResponseId === inserted.parentResponseId)
  const sameGroup = siblings.filter((response) => userBranchKey(response) === key)
  const members = new Set([inserted.id, ...sameGroup.flatMap((response) => [response.id, ...response.branches.assistant.ids])])
  const withMember = (ids: string[]) => {
    if (ids.includes(inserted.id)) return ids
    const slot = ids.findIndex((id) => members.has(id))
    return slot < 0 ? [...ids, inserted.id] : ids.map((id, index) => index === slot ? inserted.id : id)
  }
  const withAssistant = (ids: string[]) => ids.includes(inserted.id) ? ids : [...ids, inserted.id]
  const reference = siblings.at(-1)
  const own: T = {
    ...inserted,
    branches: {
      user: reference ? branchAt(withMember(reference.branches.user.ids), inserted.id) : inserted.branches.user,
      assistant: branchAt(withAssistant(sameGroup.at(-1)?.branches.assistant.ids ?? inserted.branches.assistant.ids), inserted.id),
    },
  }
  return [...responses.map((response) => {
    if (response.parentResponseId !== inserted.parentResponseId) return response
    const user = userBranchKey(response) === key ? response.branches.user.ids : withMember(response.branches.user.ids)
    const assistant = userBranchKey(response) === key
      ? withAssistant(response.branches.assistant.ids)
      : response.branches.assistant.ids
    return { ...response, branches: { user: branchAt(user, response.id), assistant: branchAt(assistant, response.id) } }
  }), own].sort(compareResponses)
}

/** Remove a local response from cached sibling metadata without recomputing from a partial page. */
export function withoutBranchResponse<T extends BranchResponse>(input: T[], removedId: string): T[] {
  const removed = input.find((response) => response.id === removedId)
  const responses = input.filter((response) => response.id !== removedId)
  if (!removed) return responses
  const replacement = removed.branches.assistant.ids.filter((id) => id !== removedId).at(-1)
  return responses.map((response) => {
    if (response.parentResponseId !== removed.parentResponseId) return response
    const userIds = response.branches.user.ids.flatMap((id) => {
      if (id !== removedId) return [id]
      return replacement && !response.branches.user.ids.includes(replacement) ? [replacement] : []
    })
    const assistantIds = response.branches.assistant.ids.filter((id) => id !== removedId)
    return { ...response, branches: { user: branchAt(userIds, response.id), assistant: branchAt(assistantIds, response.id) } }
  })
}
