import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { FileListing, TrashItem, TrashListing, TrashRetention } from '@pulpo/contracts'
import { fetchTrash, fetchTrashFolder, trashFolderQueryKey, trashQueryKey } from './api'

/** The trash, or a trashed folder in it, as a Files listing with each item's deadline. */
export interface TrashView extends FileListing {
  folder: TrashItem | null
  children: TrashItem[]
  retention: TrashRetention
  /** Whether Files items are included (the administrator can turn Files off). */
  files: boolean
}

const fromListing = (listing: TrashListing): TrashView => ({
  folder: null, ancestors: [], children: listing.items, retention: listing.retention, files: listing.files,
})

/** Lists `location` (from trashLocation) while it is set; deadlines move, so it refreshes now and then. */
export function useTrashView(userId: string | undefined, location: { folderId: string | null } | null): UseQueryResult<TrashView> {
  const folderId = location?.folderId ?? null
  const root = useQuery({
    queryKey: trashQueryKey(userId),
    queryFn: fetchTrash,
    select: fromListing,
    enabled: Boolean(userId && location && !folderId),
    refetchInterval: 60_000,
  })
  const folder = useQuery({
    queryKey: trashFolderQueryKey(userId, folderId ?? ''),
    queryFn: () => fetchTrashFolder(folderId!),
    enabled: Boolean(userId && folderId),
    refetchInterval: 60_000,
  })
  return folderId ? folder : root
}
