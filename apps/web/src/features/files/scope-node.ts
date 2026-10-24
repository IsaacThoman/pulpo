import { useQuery } from '@tanstack/react-query'
import { FILE_SCOPE_ROOT, type FileNode } from '@pulpo/contracts'
import { useAuth } from '@/stores/auth'
import { fetchFileNode, fileNodeQueryKey } from './api'

/** A Files scope item (or My files, `root`), and whether it is gone or in the trash. */
export function useScopeNode(id: string): { node: FileNode | null; missing: boolean } {
  const userId = useAuth((state) => state.user?.id)
  const root = id === FILE_SCOPE_ROOT
  const query = useQuery({
    queryKey: fileNodeQueryKey(userId, id),
    queryFn: () => fetchFileNode(id),
    enabled: Boolean(userId && !root),
    retry: false,
  })
  const node = query.data?.node ?? null
  return { node, missing: !root && (query.isError || Boolean(node?.trashedAt)) }
}
