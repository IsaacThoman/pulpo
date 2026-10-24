import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { FILE_IMPORT_URL_MAX_LENGTH, type FileNode } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ui } from '@/i18n/ui'
import { importFromUrl, normalizeImportUrl } from './api'
import { filesErrorMessage } from './file-display'

/** Asks for a web page to save in `parentId` as an editable document. */
export function ImportUrlDialog({ open, parentId, onOpenChange, onImported }: {
  open: boolean
  parentId: string | null
  onOpenChange: (open: boolean) => void
  onImported: (node: FileNode) => void
}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The page is still being fetched while busy; closing then would drop the result.
  const changeOpen = (next: boolean) => {
    if (busy) return
    if (!next) { setUrl(''); setError('') }
    onOpenChange(next)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = normalizeImportUrl(url)
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      const node = await importFromUrl(parentId, target)
      setUrl('')
      onOpenChange(false)
      onImported(node)
    } catch (cause) {
      setError(filesErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{ui("Import from URL")}</DialogTitle>
            <DialogDescription>{ui("Saves the page's text in this folder as a document you can edit.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="file-import-url">{ui("Web address")}</Label>
            <Input
              id="file-import-url"
              inputMode="url"
              autoComplete="url"
              autoFocus
              spellCheck={false}
              placeholder="https://example.com/article"
              value={url}
              maxLength={FILE_IMPORT_URL_MAX_LENGTH}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'file-import-url-error' : undefined}
              onChange={(event) => { setUrl(event.target.value); setError('') }}
            />
            {error && <p id="file-import-url-error" className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>{ui("Cancel")}</Button>
            <Button type="submit" disabled={busy || !url.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? ui("Importing…") : ui("Import")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
