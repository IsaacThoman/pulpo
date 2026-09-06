import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useState } from 'react'
import type { LocalShelvedDraft } from '@pulpo/client-core'
import { Archive, ChevronDown, GripVertical, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ui } from '@/i18n/ui'

export function ShelvedDrafts({ rows, busy, collapsed, onCollapse, onRestore, onDelete, onReorder, onRetry }: {
  rows: LocalShelvedDraft[]; busy: boolean; collapsed: boolean; onCollapse: () => void
  onRestore: (id: string) => void; onDelete: (id: string) => void
  onReorder: (id: string, targetId: string, edge: 'before' | 'after') => void; onRetry: () => void
}) {
  const [deleting, setDeleting] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  if (!rows.length) return null
  const actionClass = 'flex size-9 shrink-0 sm:size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40'
  return <section aria-label={ui('Shelved drafts')} className="-mb-3 rounded-t-2xl border border-b-0 bg-card px-2 pt-1 pb-3 shadow-sm">
    <button type="button" onClick={onCollapse} aria-expanded={!collapsed} className="flex w-full items-center gap-2 px-2 py-2 text-xs font-medium text-muted-foreground">
      <Archive className="size-3.5" /><span>{ui('Shelved')} · {rows.length}</span><ChevronDown className={`ml-auto size-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
    </button>
    {!collapsed && <div className="max-h-48 overflow-y-auto pb-1">
      {rows.map((row, index) => <div key={row.id} draggable={!busy && rows.length > 1}
        onDragStart={(event) => { setDragId(row.id); event.dataTransfer.setData('text/plain', row.id); event.dataTransfer.effectAllowed = 'move' }}
        onDragOver={(event) => { if (!dragId || dragId === row.id) return; event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setDrop({ id: row.id, edge: event.clientY < box.top + box.height / 2 ? 'before' : 'after' }) }}
        onDrop={(event) => { event.preventDefault(); if (dragId && drop?.id === row.id) onReorder(dragId, row.id, drop.edge); setDragId(null); setDrop(null) }}
        onDragEnd={() => { setDragId(null); setDrop(null) }}
        className={`relative flex min-w-0 items-start gap-1 rounded-lg px-1 py-1.5 text-sm ${dragId === row.id ? 'opacity-40' : ''} ${row.status === 'failed' ? 'bg-destructive/5' : ''}`}>
        {drop?.id === row.id && <div className={`pointer-events-none absolute inset-x-1 h-0.5 bg-foreground/35 ${drop.edge === 'before' ? 'top-0' : 'bottom-0'}`} />}
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" disabled={busy || rows.length < 2} aria-label={ui('Reorder shelved draft')} className={`${actionClass} cursor-grab`}>
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button></DropdownMenuTrigger><DropdownMenuContent align="start">
          <DropdownMenuItem disabled={index === 0} onSelect={() => onReorder(row.id, rows[index - 1]!.id, 'before')}>{ui('Move up')}</DropdownMenuItem>
          <DropdownMenuItem disabled={index === rows.length - 1} onSelect={() => onReorder(row.id, rows[index + 1]!.id, 'after')}>{ui('Move down')}</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
        <button type="button" disabled={busy} onClick={() => onRestore(row.id)} aria-label={`${ui('Restore draft')}: ${row.content.slice(0, 200) || ui('Attachments')}`} className="min-w-0 flex-1 rounded text-left focus-visible:outline-ring">
          <p className="truncate">{row.content.slice(0, 200) || ui('Attachments')}</p>
          {row.attachments.length > 0 && <p className="truncate text-xs text-muted-foreground">{row.attachments.map((a) => a.name).join(', ')}</p>}
          {row.status && <p role="status" className={`flex items-center gap-1 text-xs ${row.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {row.status === 'uploading' && <Loader2 className="size-3 animate-spin" />}
            {row.status === 'failed' ? row.error : row.status === 'uploading' ? ui('Uploading…') : ui('Waiting to sync')}
          </p>}
        </button>
        {row.status === 'failed' && <button type="button" disabled={busy} onClick={onRetry} className="px-1 text-xs text-destructive">{ui('Retry')}</button>}
        <button type="button" className={actionClass} disabled={busy} aria-label={ui('Delete shelved draft')} onClick={() => setDeleting(row.id)}><Trash2 className="size-3.5" /></button>
        <button type="button" className={actionClass} disabled={busy} aria-label={ui('Restore draft')} onClick={() => onRestore(row.id)}><RotateCcw className="size-3.5" /></button>
      </div>)}
    </div>}
    <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
      <DialogContent className="sm:max-w-sm"><DialogTitle>{ui('Delete shelved draft?')}</DialogTitle>
        <DialogDescription>{ui('This removes the saved prompt and its attachments from your shelf.')}</DialogDescription>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleting(null)}>{ui('Cancel')}</Button><Button variant="destructive" onClick={() => { if (deleting) onDelete(deleting); setDeleting(null) }}>{ui('Delete')}</Button></div>
      </DialogContent>
    </Dialog>
  </section>
}
