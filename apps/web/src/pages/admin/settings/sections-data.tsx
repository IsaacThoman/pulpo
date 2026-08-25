import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Field, Section } from '@/components/admin/kit'
import { Button } from '@/components/ui/button'
import { apiRequest, authenticatedFetch, downloadApiFile } from '@/lib/api'
import { ui } from '@/i18n/ui'

async function requestExport(type: 'config' | 'chats' | 'users' | 'usage'): Promise<void> {
  const job = await apiRequest<{ id: string }>('/api/admin/exports', { method: 'POST', body: { type } })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const result = await apiRequest<{ data: Array<{ id: string; status: string; error?: string }> }>('/api/admin/exports')
    const current = result.data.find((candidate) => candidate.id === job.id)
    if (current?.status === 'completed') {
      await downloadApiFile(`/api/admin/exports/${job.id}/download`)
      return
    }
    if (current?.status === 'failed') throw new Error(current.error ?? 'Export failed')
  }
  throw new Error(ui("Export is still processing"))
}

export function DatabaseSection() {
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('')
  const createBackup = async () => { const job = await apiRequest<{ id: string }>('/api/admin/backups', { method: 'POST' }); setStatus('Building backup…'); for (let i = 0; i < 600; i += 1) { await new Promise((resolve) => setTimeout(resolve, 1000)); const result = await apiRequest<{ data: Array<{ id: string; status: string; progress: number; error?: string }> }>('/api/admin/backups'); const current = result.data.find((x) => x.id === job.id); if (current) setStatus(`Backup ${current.progress}%`); if (current?.status === 'completed') { await downloadApiFile(`/api/admin/backups/${job.id}/download`); setStatus('Backup ready'); return } if (current?.status === 'failed') { setStatus(current.error ?? 'Backup failed'); return } } }
  const restore = async () => { if (!restoreFile || confirmation !== 'RESTORE') return; const form = new FormData(); form.append('confirmation', confirmation); form.append('file', restoreFile); setStatus('Uploading and validating restore…'); const response = await authenticatedFetch('/api/admin/restore', { method: 'POST', body: form }); const result = await response.json(); if (!response.ok) { setStatus(result?.error?.message ?? 'Restore failed'); return } for (let i = 0; i < 3600; i += 1) { await new Promise((resolve) => setTimeout(resolve, 1000)); const jobs = await apiRequest<{ data: Array<{ id: string; status: string; progress: number; error?: string }> }>('/api/admin/backups').catch(() => null); const current = jobs?.data.find((x) => x.id === result.id); if (!current) { location.assign('/login'); return } setStatus(`Restore ${current.progress}%`); if (current.status === 'completed') { location.assign('/login'); return } if (current.status === 'failed') { setStatus(current.error ?? 'Restore failed'); return } } }
  return (
    <div>
      <Section title={ui("Config")}>
        <Field label={ui("Export config")}>
          <Button variant="outline" size="sm" onClick={() => void requestExport('config')}>
            <Download /> {ui("Export")} </Button>
        </Field>
      </Section>

      <Section title={ui("Database")}>
        <Field label={ui("Full application backup")} hint="Versioned .tar.gz containing durable database state, encrypted secrets, detailed payloads still in retention, and ready attachment blobs.">
          <Button variant="outline" size="sm" onClick={() => void createBackup()}><Download />{ui("Backup instance")}</Button>
        </Field>
        <div className="space-y-3 border-t py-4"><div><div className="text-sm font-medium text-destructive">{ui("Recover full application")}</div><p className="mt-1 text-xs text-muted-foreground">{ui("This replaces all durable instance data, invalidates sessions, and returns everyone to login. Validation failures leave the current instance unchanged.")}</p></div><input type="file" accept=".tar.gz,application/gzip" onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} className="block w-full text-xs" /><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={ui("Type RESTORE")} className="h-9 w-48 rounded-md border bg-background px-3 text-sm" /><Button variant="destructive" size="sm" disabled={!restoreFile || confirmation !== 'RESTORE'} onClick={() => void restore()}><Upload />{ui("Replace and restore")}</Button></div>
        {status && <div className="rounded-md border bg-muted/30 p-3 text-xs">{status}</div>}
        <Field label={ui("Export all chats (all users)")}>
          <Button variant="outline" size="sm" onClick={() => void requestExport('chats')}>
            <Download /> {ui("Export JSON")} </Button>
        </Field>
        <Field label={ui("Export users")}>
          <Button variant="outline" size="sm" onClick={() => void requestExport('users')}>
            <Download /> {ui("Export CSV")} </Button>
        </Field>
      </Section>

      <Section title={ui("Usage")}>
        <Field label={ui("Export usage records")}>
          <Button variant="outline" size="sm" onClick={() => void requestExport('usage')}><Download />{ui("Export CSV")}</Button>
        </Field>
      </Section>
    </div>
  )
}
