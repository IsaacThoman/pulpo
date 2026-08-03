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
