import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fileNameError, normalizeFileName, type FileNode } from '@pulpo/contracts'
import { Download, FolderDown, FolderInput, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { uit, ui } from '@/i18n/ui'
import type { Attachment } from '@/lib/types'
import { useAuth } from '@/stores/auth'
import { deleteFileNodes, fetchFolder, filesQueryKey, folderQueryKey, restoreFileNodes, trashFileNodes } from '@/features/files/api'
import { fileNameErrorMessage, filesErrorMessage } from '@/features/files/file-display'
import { FolderBrowser } from '@/features/files/FileMoveDialog'
import { uniqueChildName } from '@/features/files/browser/sort'
import { useFileToasts } from '@/features/files/browser/toasts'
import { revealFile } from '@/features/files/reveal'
import { useSidePanel } from '@/features/side-panel/store'
import { useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { saveAttachmentToFiles } from './attachment-actions'

type Saved = Awaited<ReturnType<typeof saveAttachmentToFiles>>

/**
 * Whether attachments can be saved to Files here. Admin chat views, the only screens without a
 * side panel, show another account's chat, whose attachments must not land in anyone's Files.
 */
function useCanSaveToFiles(): boolean {
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const panelEnabled = useSidePanel((state) => state.enabled)
  return filesEnabled && panelEnabled
}

/**
 * Picks a folder and a name. The name starts as the attachment's, numbered (" (n)") when the
 * folder already has it. The folder's files show grayed out; picking one takes its name. A name
 * already in use asks first: overwrite that file (it moves to the trash), save separately (the
 * server adds the number), or go back.
 */
export function SaveToFilesDialog({ attachment, open, onOpenChange, onSaved }: {
  attachment: Attachment
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (saved: Saved) => void
}) {
  const userId = useAuth((state) => state.user?.id)
  const [folderId, setFolderId] = useState<string | null>(null)
  // What the user typed or picked; until then the name follows the folder's next free name.
  const [chosen, setChosen] = useState<{ name: string; picked: boolean } | null>(null)
  const [clash, setClash] = useState<FileNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFolderId(null)
    setChosen(null)
    setClash(null)
    setError(null)
  }, [attachment.name, open])

  // The same listing the browser shows, to check the name against.
  const listing = useQuery({ queryKey: folderQueryKey(userId, folderId), queryFn: () => fetchFolder(folderId), enabled: Boolean(open && userId) })
  const name = chosen?.name ?? (listing.data ? uniqueChildName(attachment.name, listing.data.children) : attachment.name)
  const normalized = normalizeFileName(name)
  const match = listing.data?.children.find((node) => node.name.toLowerCase() === normalized.toLowerCase()) ?? null

  const navigate = (next: string | null) => {
    setFolderId(next)
    // A typed name carries over; a picked file's name belongs to the folder being left.
    setChosen((current) => current?.picked ? null : current)
    setClash(null)
    setError(null)
  }

  const save = async (replaceId?: string) => {
    setSaving(true)
    setError(null)
    try {
      onSaved(await saveAttachmentToFiles(attachment.id, { parentId: folderId, name: normalized, replaceId }))
      onOpenChange(false)
    } catch (cause) {
      setClash(null)
      setError(filesErrorMessage(cause, normalized))
    } finally {
      setSaving(false)
    }
  }

  const submit = () => {
    const invalid = fileNameError(normalized)
    if (invalid) { setError(fileNameErrorMessage(invalid)); return }
    if (match) setClash(match)
    else void save()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{uit`Save "${attachment.name}" to Files`}</DialogTitle>
          <DialogDescription>{ui("Choose a folder and a name.")}</DialogDescription>
        </DialogHeader>
        {open && (
          <FolderBrowser
            folderId={folderId}
            onNavigate={navigate}
            files={{
              selectedId: match && match.kind !== 'folder' ? match.id : null,
              onSelect: (node) => { setChosen({ name: node.name, picked: true }); setClash(null); setError(null) },
            }}
          />
        )}
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">{ui("Name")}</span>
          <Input
            value={name}
            disabled={saving}
            aria-invalid={Boolean(error)}
            onChange={(event) => { setChosen({ name: event.target.value, picked: false }); setClash(null); setError(null) }}
            onKeyDown={(event) => { if (event.key === 'Enter' && !clash) { event.preventDefault(); submit() } }}
          />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {clash ? (
          <>
            <div role="alert" className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>{clash.kind === 'folder'
                ? uit`A folder named "${clash.name}" already exists here. Save a separate copy with a number added?`
                : uit`"${clash.name}" already exists here. Overwrite it, or save a separate copy with a number added? An overwritten file moves to the trash.`}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => setClash(null)}>{ui("Cancel")}</Button>
              <Button type="button" variant="outline" disabled={saving} onClick={() => void save()}>{ui("Save separately")}</Button>
              {clash.kind !== 'folder' && (
                <Button type="button" variant="destructive" disabled={saving} onClick={() => void save(clash.id)}>
                  {saving && <Loader2 className="animate-spin" />}{ui("Overwrite")}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="button" disabled={saving || listing.isPending || listing.isError || !normalized} onClick={submit}>
              {saving && <Loader2 className="animate-spin" />}{ui("Save")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Keeping an attachment: one button whose menu downloads it or saves it to Files. After saving, the
 * toast offers to show the file in its folder, or to undo (which also restores an overwritten
 * file). Where Files is unavailable the button simply downloads.
 */
export function AttachmentSaveMenu({ attachment, onDownload, className }: {
  attachment: Attachment
  onDownload: () => void
  className: string
}) {
  const [picking, setPicking] = useState(false)
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const show = useFileToasts((state) => state.show)
  const go = useMainNavigate()
  const canSave = useCanSaveToFiles()

  if (!canSave) {
    return (
      <button type="button" onClick={onDownload} aria-label={uit`Download ${attachment.name}`} title={ui("Download")} className={className}>
        <Download className="size-4" aria-hidden="true" />
      </button>
    )
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
  const saved = ({ node, replacedId }: Saved) => {
    void refresh()
    show({
      message: replacedId ? uit`Overwrote "${node.name}"` : uit`Saved "${node.name}" to Files`,
      action: { label: ui("Show"), run: () => revealFile(node, go) },
      undo: async () => {
        try {
          await deleteFileNodes(await trashFileNodes([node.id]))
          if (replacedId) await restoreFileNodes([replacedId])
        } finally {
          await refresh()
        }
      },
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={uit`Save ${attachment.name}`} title={ui("Save")} className={className}>
            <FolderDown className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDownload}><Download /> {ui("Download")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicking(true)}><FolderInput /> {ui("Save to Files…")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveToFilesDialog attachment={attachment} open={picking} onOpenChange={setPicking} onSaved={saved} />
    </>
  )
}
