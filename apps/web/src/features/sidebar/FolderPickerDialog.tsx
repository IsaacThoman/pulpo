import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FolderBrowser } from '@/features/files/FileMoveDialog'
import { ui } from '@/i18n/ui'
import { useFolderPicker } from './api'

/** The destination dialog behind `pickFolder`: browse Files and choose a folder. */
export function FolderPickerDialog() {
  const request = useFolderPicker((state) => state.request)
  const [folderId, setFolderId] = useState<string | null>(null)
  useEffect(() => { if (request) setFolderId(request.initialFolderId) }, [request])

  const finish = (result: string | null | undefined) => {
    request?.resolve(result)
    useFolderPicker.setState({ request: null })
  }

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open) finish(undefined) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription>{ui("Choose a destination folder.")}</DialogDescription>
        </DialogHeader>
        {request && <FolderBrowser folderId={folderId} onNavigate={setFolderId} excludedIds={request.excludedIds} />}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => finish(undefined)}>{ui("Cancel")}</Button>
          <Button type="button" onClick={() => finish(folderId)}>{request?.action}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
