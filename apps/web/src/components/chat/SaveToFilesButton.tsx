import { useEffect, useState } from 'react'
import { Check, FolderInput } from 'lucide-react'
import { FolderPickerDialog } from '@/features/files/FolderPickerDialog'
import { saveAttachmentToFiles } from '@/features/files/api'
import type { Attachment } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { ui, uit } from '@/i18n/ui'

/** Copies an uploaded or generated attachment into a Files folder the user picks. Hidden when Files is off. */
export function SaveToFilesButton({
  attachment,
  className,
  iconClassName = 'size-4',
}: {
  attachment: Attachment
  className?: string
  iconClassName?: string
}) {
  const filesEnabled = useAuth((state) => state.filesEnabled && Boolean(state.user))
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return
    const timeout = window.setTimeout(() => setSaved(false), 1500)
    return () => window.clearTimeout(timeout)
  }, [saved])

  if (!filesEnabled) return null
  const label = saved ? ui("Saved to Files") : uit`Save ${attachment.name} to Files`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={cn(
          'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        {saved ? <Check className={iconClassName} aria-hidden="true" /> : <FolderInput className={iconClassName} aria-hidden="true" />}
      </button>
      <FolderPickerDialog
        open={open}
        title={uit`Save "${attachment.name}" to Files`}
        description={ui("Choose a folder for the copy.")}
        confirmLabel={ui("Save here")}
        onOpenChange={setOpen}
        onConfirm={async (folderId) => {
          await saveAttachmentToFiles(attachment.id, folderId)
          setSaved(true)
        }}
      />
    </>
  )
}
