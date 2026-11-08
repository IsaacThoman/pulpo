import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ui } from '@/i18n/ui'
import { normalizeLink, type LinkTargetAccept } from './link'

export interface LinkDialogValue {
  /** What to show for the link; empty keeps the selected text (or shows the link itself). */
  text: string
  /** The normalized target ("https://example.com", "mailto:…", or what `accept` returned). */
  url: string
}

/**
 * Insert or edit a link, as in Docs and Word: "Text to display" (only where the editor can use it,
 * e.g. nothing is selected) and "Link". Enter applies; "example.com" becomes https://example.com;
 * `accept` lets an editor take its own targets (cell references). Editing an existing link adds
 * Remove link. Replaces `window.prompt`, which the desktop app cannot show.
 */
export function LinkDialog({ open, onOpenChange, url, text, showText = false, editing = false, accept, onApply, onRemove, returnFocus, title, description }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The link being edited, if any. */
  url?: string
  text?: string
  showText?: boolean
  editing?: boolean
  accept?: LinkTargetAccept
  onApply: (value: LinkDialogValue) => void
  onRemove?: () => void
  /** Puts focus back in the document once the dialog closes. */
  returnFocus?: () => void
  title?: string
  description?: string
}) {
  const [textValue, setTextValue] = useState('')
  const [urlValue, setUrlValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const urlInput = useRef<HTMLInputElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    setTextValue(text ?? '')
    setUrlValue(url ?? '')
    setError(null)
  }, [open, text, url])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const checked = normalizeLink(urlValue, accept)
    if (!checked.ok) {
      setError(checked.error)
      urlInput.current?.focus()
      return
    }
    onOpenChange(false)
    onApply({ text: showText ? textValue.trim() : '', url: checked.url })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return
          event.preventDefault()
          returnFocus()
        }}
        data-link-dialog=""
      >
        <form className="space-y-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{title ?? (editing ? ui("Edit link") : ui("Insert link"))}</DialogTitle>
            <DialogDescription>{description ?? ui("A web address, an email address, or a phone number (tel:).")}</DialogDescription>
          </DialogHeader>
          {showText && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-text`}>{ui("Text to display")}</Label>
              <Input id={`${id}-text`} value={textValue} onChange={(event) => setTextValue(event.target.value)} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-url`}>{ui("Link")}</Label>
            <Input
              ref={urlInput}
              id={`${id}-url`}
              value={urlValue}
              onChange={(event) => { setUrlValue(event.target.value); setError(null) }}
              placeholder="https://example.com"
              autoComplete="url"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              autoFocus
            />
            {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:items-center">
            {editing && onRemove && (
              <Button type="button" variant="ghost" className="sm:mr-auto" onClick={() => { onOpenChange(false); onRemove() }}>{ui("Remove link")}</Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{ui("Apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
