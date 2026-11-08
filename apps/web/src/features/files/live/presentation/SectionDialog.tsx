import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ui } from '@/i18n/ui'

/**
 * Names a new section or renames one, as PowerPoint's Add Section and Rename Section ask. An empty
 * name keeps PowerPoint's "Untitled Section" for a new section and the old name for a rename.
 */
export function SectionDialog({ open, onOpenChange, mode, name, onApply, returnFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'rename'
  /** The section's name (rename). */
  name?: string
  onApply: (name: string) => void
  returnFocus?: () => void
}) {
  const [value, setValue] = useState('')
  const id = useId()
  useEffect(() => {
    if (open) setValue(mode === 'rename' ? (name ?? '') : '')
  }, [open, mode, name])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = value.trim()
    onOpenChange(false)
    if (trimmed) onApply(trimmed)
    else if (mode === 'add') onApply(ui("Untitled section"))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        data-section-dialog=""
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return
          event.preventDefault()
          returnFocus()
        }}
      >
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{mode === 'add' ? ui("Add section") : ui("Rename section")}</DialogTitle>
            <DialogDescription>{mode === 'add' ? ui("The section starts at this slide and runs to the next section.") : ui("Sections group slides in the slide list.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>{ui("Section name")}</Label>
            <Input id={`${id}-name`} value={value} onChange={(event) => setValue(event.target.value)} placeholder={ui("Untitled section")} maxLength={200} autoFocus onFocus={(event) => event.currentTarget.select()} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
            <Button type="submit">{mode === 'add' ? ui("Add") : ui("Rename")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
