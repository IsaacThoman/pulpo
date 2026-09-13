import { ui, uit } from '@/i18n/ui'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function AttachmentWindow<T>({ items, children }: { items: T[]; children: (visible: T[]) => ReactNode }) {
  const [page, setPage] = useState(0)
  const size = 20
  const last = Math.max(0, Math.ceil(items.length / size) - 1)
  const current = Math.min(page, last)
  return <div className="w-full min-w-0 space-y-2">
    {items.length > size && <nav aria-label={ui("Attachment pages")} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <Button type="button" variant="ghost" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>{ui("Previous")}</Button>
      <span aria-live="polite">{uit`${current * size + 1}–${Math.min(items.length, (current + 1) * size)} of ${items.length} files`}</span>
      <Button type="button" variant="ghost" size="sm" disabled={current === last} onClick={() => setPage(current + 1)}>{ui("Next")}</Button>
    </nav>}
    {children(items.slice(current * size, (current + 1) * size))}
  </div>
}
