import { useEffect, useRef, useState, type FormEvent } from 'react'
import { fileNameError, normalizeFileName } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ui } from '@/i18n/ui'
import { fileNameErrorMessage, filesErrorMessage } from './file-display'

export function FileNameDialog({
  open,
  title,
  initialName,
  submitLabel,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  title: string
  initialName: string
  submitLabel: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => Promise<unknown>
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setError(null)
    // Select the base name so typing replaces it without touching the extension.
    const frame = requestAnimationFrame(() => {
      const dot = initialName.lastIndexOf('.')
      inputRef.current?.setSelectionRange(0, dot > 0 ? dot : initialName.length)
    })
    return () => cancelAnimationFrame(frame)
  }, [open, initialName])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = normalizeFileName(name)
    const invalid = fileNameError(normalized)
    if (invalid) {
      setError(fileNameErrorMessage(invalid))
      return
    }
    setSaving(true)
    try {
      await onSubmit(normalized)
      onOpenChange(false)
    } catch (cause) {
      setError(filesErrorMessage(cause, normalized))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              ref={inputRef}
              autoFocus
              value={name}
              aria-label={ui("Name")}
              aria-invalid={Boolean(error)}
              onChange={(event) => { setName(event.target.value); setError(null) }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit" disabled={saving || !name.trim()}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
