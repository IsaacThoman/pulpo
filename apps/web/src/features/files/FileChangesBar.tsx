import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSidePanel } from '@/features/side-panel/store'
import { ui, uit } from '@/i18n/ui'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { filesErrorMessage } from './file-display'
import { FileNodeIcon } from './FileNodeIcon'

interface FileChange {
  nodeId: string
  name: string
  nodeKind: 'folder' | 'doc' | 'blob'
  change: 'edit' | 'create'
  reverted: boolean
}

/** What an agent reply changed in Files, with one Undo for all of it. */
export function FileChangesBar({ responseId }: { responseId: string }) {
  const userId = useAuth((state) => state.user?.id)
  const queryClient = useQueryClient()
  const queryKey = ['file-changes', userId, responseId]
  const changes = useQuery({
    queryKey,
    queryFn: () => apiRequest<{ changes: FileChange[] }>(`/api/responses/${responseId}/file-changes`).then((body) => body.changes),
    enabled: Boolean(userId),
    staleTime: 30_000,
  })
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const items = changes.data ?? []
  if (!items.length) return null
  const reverted = items.every((item) => item.reverted)

  const undo = async () => {
    setUndoing(true)
    setError(null)
    try {
      await apiRequest(`/api/responses/${responseId}/file-changes/revert`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey })
    } catch (cause) {
      setError(filesErrorMessage(cause))
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{reverted ? ui("Undid changes to") : items.length === 1 ? ui("Changed") : uit`Changed ${items.length} items:`}</span>
      {items.map((item) => (
        <button
          key={item.nodeId}
          type="button"
          className="inline-flex max-w-48 cursor-pointer items-center gap-1 rounded px-1 text-foreground hover:bg-background/70"
          title={item.change === 'create' ? ui("Created by the agent") : ui("Edited by the agent")}
          onClick={() => useSidePanel.getState().open(item.nodeKind === 'folder' ? { kind: 'folder', id: item.nodeId } : { kind: 'file', id: item.nodeId })}
        >
          <FileNodeIcon node={{ kind: item.nodeKind, name: item.name, mimeType: null }} className="size-3.5 shrink-0" />
          <span className="truncate">{item.name}</span>
          {item.change === 'create' && <span className="text-muted-foreground">{ui("(new)")}</span>}
        </button>
      ))}
      <span className="flex-1" />
      {!reverted && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={undoing} onClick={() => void undo()}>
          {undoing ? <Loader2 className="animate-spin" /> : <Undo2 />} {ui("Undo")}
        </Button>
      )}
      {error && <p role="alert" className="w-full text-destructive">{error}</p>}
    </div>
  )
}
