export interface DuplicateTreeNode {
  id: string
  parentResponseId: string | null
  previousResponseId: string | null
  userMessageId: string | null
}

export interface DuplicateTreePlan {
  responseIds: Map<string, string>
  userMessageIds: Map<string, string>
  remap(node: DuplicateTreeNode): {
    id: string
    parentResponseId: string | null
    previousResponseId: string | null
    userMessageId: string | null
  }
}

export function planDuplicateTree(nodes: DuplicateTreeNode[], createId: () => string): DuplicateTreePlan {
  const responseIds = new Map(nodes.map((node) => [node.id, createId()]))
  const userMessageIds = new Map<string, string>()
  for (const node of nodes) {
    if (node.userMessageId && !userMessageIds.has(node.userMessageId)) {
      userMessageIds.set(node.userMessageId, createId())
    }
  }
  return {
    responseIds,
    userMessageIds,
    remap: (node) => ({
      id: responseIds.get(node.id)!,
      parentResponseId: node.parentResponseId ? responseIds.get(node.parentResponseId) ?? null : null,
      previousResponseId: node.previousResponseId ? responseIds.get(node.previousResponseId) ?? null : null,
      userMessageId: node.userMessageId ? userMessageIds.get(node.userMessageId) ?? null : null,
    }),
  }
}
