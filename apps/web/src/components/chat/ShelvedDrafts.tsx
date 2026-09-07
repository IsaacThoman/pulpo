import { useState } from 'react'
import type { LocalShelvedDraft } from '@pulpo/client-core'
import { Archive, CornerDownRight, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { ComposerTray } from './ComposerTray'

export function ShelvedDrafts({ rows, busy, collapsed, onCollapse, onRestore, onDelete, onReorder, onRetry }: {
  rows: LocalShelvedDraft[]; busy: boolean; collapsed: boolean; onCollapse: () => void
  onRestore: (id: string) => void; onDelete: (id: string) => void
  onReorder: (id: string, targetId: string, edge: 'before' | 'after') => void; onRetry: () => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  if (!rows.length) return null
  const actionClass = 'flex size-9 shrink-0 sm:size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40'
  return <ComposerTray label={ui('Shelved drafts')} title={ui('Shelved')} icon={<Archive aria-hidden="true" className="size-3.5" />}
    count={rows.length} collapsed={collapsed} onCollapse={onCollapse}>
      {rows.map((row, index) => <div key={row.id} draggable={!busy && rows.length > 1}
        role="group" aria-label={ui('Reorder shelved draft')} tabIndex={!busy && rows.length > 1 ? 0 : undefined}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        onKeyDown={(event) => {
          if (busy || event.target !== event.currentTarget || !event.altKey) return
          const target = event.key === 'ArrowUp' ? rows[index - 1] : event.key === 'ArrowDown' ? rows[index + 1] : undefined
          if (target) { event.preventDefault(); onReorder(row.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after') }
        }}
        onDragStart={(event) => { setDragId(row.id); event.dataTransfer.setData('text/plain', row.id); event.dataTransfer.effectAllowed = 'move' }}
        onDragOver={(event) => { if (!dragId || dragId === row.id) return; event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setDrop({ id: row.id, edge: event.clientY < box.top + box.height / 2 ? 'before' : 'after' }) }}
        onDrop={(event) => { event.preventDefault(); if (dragId && drop?.id === row.id) onReorder(dragId, row.id, drop.edge); setDragId(null); setDrop(null) }}
        onDragEnd={() => { setDragId(null); setDrop(null) }}
        className={`relative flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-sm focus-visible:outline-ring ${!busy && rows.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''} ${dragId === row.id ? 'opacity-40' : ''} ${row.status === 'failed' ? 'bg-destructive/5' : ''}`}>
        {drop?.id === row.id && <div className={`pointer-events-none absolute inset-x-1 h-0.5 bg-foreground/35 ${drop.edge === 'before' ? 'top-0' : 'bottom-0'}`} />}
        <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <button type="button" disabled={busy} onClick={() => onRestore(row.id)} aria-label={`${ui('Restore draft')}: ${row.content.slice(0, 200) || ui('Attachments')}`} className="min-w-0 flex-1 rounded text-left focus-visible:outline-ring">
          <p className="truncate">{row.content.slice(0, 200) || ui('Attachments')}</p>
          {row.attachments.length > 0 && <p className="truncate text-xs text-muted-foreground">{row.attachments.map((a) => a.name).join(', ')}</p>}
          {row.status && <p role="status" className={`flex items-center gap-1 text-xs ${row.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {row.status === 'uploading' && <Loader2 className="size-3 animate-spin" />}
            {row.status === 'failed' ? row.error : row.status === 'uploading' ? ui('Uploading…') : ui('Waiting to sync')}
          </p>}
        </button>
        {row.status === 'failed' && <button type="button" disabled={busy} onClick={onRetry} className="px-1 text-xs text-destructive">{ui('Retry')}</button>}
        <button type="button" className={actionClass} disabled={busy} aria-label={ui('Delete shelved draft')} onClick={() => onDelete(row.id)}><Trash2 className="size-3.5" /></button>
        <button type="button" className={actionClass} disabled={busy} aria-label={ui('Restore draft')} onClick={() => onRestore(row.id)}><RotateCcw className="size-3.5" /></button>
      </div>)}
  </ComposerTray>
}
