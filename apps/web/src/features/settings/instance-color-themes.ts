import { queryOptions } from '@tanstack/react-query'
import { instanceColorThemesSnapshotSchema } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { runtimeAccountKey } from '@/lib/runtime'

export function instanceColorThemesQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ['instance-color-themes', userId ? runtimeAccountKey(userId) : null],
    queryFn: async ({ signal }) => instanceColorThemesSnapshotSchema.parse(await apiRequest('/api/interface/color-themes', { signal })),
    // Older instances do not expose a catalog. A later mount or focus can try again.
    retry: false,
  })
}
