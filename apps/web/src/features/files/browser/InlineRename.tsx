import { useEffect, useRef, useState } from 'react'
import { fileNameError, normalizeFileName, type FileNode } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { fileNameErrorMessage } from '../file-display'

/**
 * In-place name editor. Selects the name without its extension, commits on Enter or blur,
 * and cancels on Escape. Stays open with a message when the name is invalid or taken.
 */
export function InlineRename({ node, className, onCommit, onCancel }: {
  node: FileNode
  className?: string
  onCommit: (name: string) => Promise<boolean>
  onCancel: () => void
}) {
  const [value, setValue] = useState(node.name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    const element = input.current
    if (!element) return
    element.focus()
    const dot = node.kind === 'blob' ? node.name.lastIndexOf('.') : -1
    element.setSelectionRange(0, dot > 0 ? dot : node.name.length)
  }, [node.kind, node.name])

  const commit = async () => {
    if (settled.current || saving) return
    const name = normalizeFileName(value)
    if (name === node.name || !name) {
      settled.current = true
      onCancel()
      return
    }
    const invalid = fileNameError(name)
    if (invalid) {
      setError(fileNameErrorMessage(invalid))
      input.current?.focus()
      return
    }
    setSaving(true)
    const ok = await onCommit(name)
    setSaving(false)
    if (ok) settled.current = true
    else input.current?.focus()
  }

  return (
    <span className={cn('relative block min-w-0 flex-1', className)} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <input
        ref={input}
        value={value}
        disabled={saving}
        aria-label={ui("Name")}
        aria-invalid={Boolean(error)}
        onChange={(event) => { setValue(event.target.value); setError(null) }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') { event.preventDefault(); void commit() }
          if (event.key === 'Escape') { event.preventDefault(); settled.current = true; onCancel() }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        draggable={false}
        className="w-full min-w-0 rounded-sm border border-ring bg-background px-1 py-0.5 text-sm outline-none ring-2 ring-ring/30"
      />
      {error && <span role="alert" className="absolute top-full left-0 z-20 mt-1 max-w-64 rounded-md border bg-popover px-2 py-1 text-xs text-destructive shadow-md">{error}</span>}
    </span>
  )
}
