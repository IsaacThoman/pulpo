import type { FileNode } from '@pulpo/contracts'
import { queryClient } from '@/lib/query-client'
import { useAuth } from '@/stores/auth'
import { fileNodeQueryKey } from './api'
import { addFileScope, pruneFileScope } from './file-scope'

/** Adds items to a scope, then drops items a scoped folder now covers (per the node cache). */
export function extendFileScope(ids: readonly string[], added: readonly string[]): string[] {
  const userId = useAuth.getState().user?.id
  return pruneFileScope(addFileScope(ids, added), (id) => queryClient
    .getQueryData<{ node: FileNode; ancestors: FileNode[] }>(fileNodeQueryKey(userId, id))
    ?.ancestors.map((folder) => folder.id))
}
