import { newestDescendantId } from '@pulpo/client-core'
import type { QueryClient } from '@tanstack/react-query'
import type { ServerChat } from '../../../types'

interface BranchSelection {
  namespace: string
  chatId: string
  leafId: string
  previousLeafId: string | null
  version: number
}

interface ActivateOptimisticBranchInput {
  queryClient: QueryClient
  namespace: string
  chatId: string
  selectedResponseId: string
  request: (responseId: string) => Promise<{ activeBranchLeafId: string }>
}

const selections = new Map<string, BranchSelection>()
const selectionVersions = new Map<string, number>()
const mutationTails = new Map<string, Promise<unknown>>()

const detailKey = (namespace: string, chatId: string) => ['chat', namespace, chatId] as const
const selectionKey = (namespace: string, chatId: string) => `${namespace}:${chatId}`

function setActiveLeaf(queryClient: QueryClient, namespace: string, chatId: string, leafId: string | null): void {
  queryClient.setQueryData<ServerChat>(detailKey(namespace, chatId), (chat) => chat ? {
    ...chat,
    activeResponseId: leafId,
    activeBranchLeafId: leafId,
  } : chat)
}

function enqueueBranchMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(key) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  mutationTails.set(key, result)
  const cleanup = () => {
    if (mutationTails.get(key) === result) mutationTails.delete(key)
  }
  void result.then(cleanup, cleanup)
  return result
}

/**
 * Select a cached branch synchronously, then reconcile the server mutation in
 * the background. Mutations are serialized per chat so rapid taps reach the
 * server in the same order as the user's visible selections.
 */
export async function activateOptimisticBranch(input: ActivateOptimisticBranchInput): Promise<void> {
  const key = selectionKey(input.namespace, input.chatId)
  const cached = input.queryClient.getQueryData<ServerChat>(detailKey(input.namespace, input.chatId))
  const currentSelection = selections.get(key)
  const previousLeafId = currentSelection?.leafId
    ?? cached?.activeBranchLeafId
    ?? cached?.activeResponseId
    ?? null
  const responses = cached?.responses
  const selectedExists = Boolean(responses?.some((response) => response.id === input.selectedResponseId))
  const leafId = selectedExists && responses
    ? newestDescendantId(responses, input.selectedResponseId)
    : input.selectedResponseId
  const selectedDetailAvailable = Boolean(responses?.some((response) => (
    response.id === leafId && response.detailAvailable !== false
  )))
  const version = (selectionVersions.get(key) ?? 0) + 1
  selectionVersions.set(key, version)
  selections.set(key, {
    namespace: input.namespace,
    chatId: input.chatId,
    leafId,
    previousLeafId,
    version,
  })
  if (selectedDetailAvailable) setActiveLeaf(input.queryClient, input.namespace, input.chatId, leafId)

  try {
    const result = await enqueueBranchMutation(key, () => input.request(input.selectedResponseId))
    const current = selections.get(key)
    if (current?.version !== version) {
      // A newer visible choice is waiting behind this request. Record the
      // server leaf it should return to if that newer request fails.
      if (current) selections.set(key, { ...current, previousLeafId: result.activeBranchLeafId })
      return
    }
    selections.delete(key)
    const currentResult = input.queryClient.getQueryData<ServerChat>(detailKey(input.namespace, input.chatId))
    if (!currentResult?.responses?.some((response) => (
      response.id === result.activeBranchLeafId && response.detailAvailable !== false
    ))) {
      await input.queryClient.invalidateQueries({ queryKey: detailKey(input.namespace, input.chatId) })
      return
    }
    setActiveLeaf(input.queryClient, input.namespace, input.chatId, result.activeBranchLeafId)
  } catch (error) {
    const current = selections.get(key)
    if (current?.version !== version) {
      // The failed older selection never became authoritative, so preserve its
      // own fallback as the newer selection's rollback target.
      if (current) selections.set(key, { ...current, previousLeafId })
      return
    }
    selections.delete(key)
    setActiveLeaf(input.queryClient, input.namespace, input.chatId, current.previousLeafId)
    throw error
  }
}

/** Keep a pending local selection visible if an older transcript refetch lands. */
export function reconcileOptimisticBranchSelection(namespace: string, chat: ServerChat): ServerChat {
  const selection = selections.get(selectionKey(namespace, chat.id))
  if (!selection || !chat.responses?.some((response) => (
    response.id === selection.leafId && response.detailAvailable !== false
  ))) return chat
  if (chat.activeResponseId === selection.leafId && chat.activeBranchLeafId === selection.leafId) return chat
  return {
    ...chat,
    activeResponseId: selection.leafId,
    activeBranchLeafId: selection.leafId,
  }
}

export function clearOptimisticBranchSelections(namespace?: string): void {
  for (const [key, selection] of selections) {
    if (!namespace || selection.namespace === namespace) selections.delete(key)
  }
  if (!namespace) selectionVersions.clear()
}
