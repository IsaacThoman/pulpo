import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudUpload, Download, RefreshCw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { Field, NumField, SaveBar, SecretField, Section, SelectField, TextField, Toggle } from '@/components/admin/kit'
import { Button } from '@/components/ui/button'
import { apiRequest, authenticatedFetch, downloadApiFile } from '@/lib/api'
import { ui } from '@/i18n/ui'
import { formatDateTime } from '@/lib/format'
import type { BackupJob, PublicBackupSettings } from '@pulpo/contracts'
import { backupSettingsPayload, type BackupForm } from './backup-settings-form'

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

const EMPTY_BACKUP_FORM: BackupForm = {
  enabled: false,
  endpoint: '',
  bucket: '',
  prefix: 'pulpo',
  keyId: '',
  applicationKey: '',
  recipient: '',
  intervalHours: 24,
  retentionDays: 30,
}

function OffsiteBackupSection() {
  const [form, setForm] = useState<BackupForm>(EMPTY_BACKUP_FORM)
  const [settings, setSettings] = useState<PublicBackupSettings | null>(null)
  const [jobs, setJobs] = useState<BackupJob[]>([])
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const hydrated = useRef(false)

  const load = useCallback(async () => {
    const [next, history] = await Promise.all([
      apiRequest<PublicBackupSettings>('/api/admin/settings/backups'),
      apiRequest<{ data: BackupJob[] }>('/api/admin/backups?destination=backblaze_b2'),
    ])
    setSettings(next)
    if (!hydrated.current) {
      setForm({
        enabled: next.enabled,
        endpoint: next.endpoint,
        bucket: next.bucket,
        prefix: next.prefix || 'pulpo',
        keyId: next.keyId,
        applicationKey: '',
        recipient: next.recipient,
        intervalHours: next.intervalHours,
        retentionDays: next.retentionDays,
      })
      hydrated.current = true
    }
    setJobs(history.data)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 5_000)
    return () => window.clearInterval(timer)
  }, [load])

  const update = <K extends keyof BackupForm>(key: K, value: BackupForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  const test = async () => {
    setWorking(true); setMessage('Testing Backblaze access and Object Lock…')
    try {
      await apiRequest('/api/admin/settings/backups/test', { method: 'POST', body: backupSettingsPayload(form) })
      setMessage('Connection, upload, read, delete, and Object Lock checks passed.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection test failed')
    } finally { setWorking(false) }
  }

  const save = async () => {
    const next = await apiRequest<PublicBackupSettings>('/api/admin/settings/backups', { method: 'PUT', body: backupSettingsPayload(form) })
    setSettings(next); setForm((current) => ({ ...current, applicationKey: '' })); setMessage('Backup settings saved.'); await load()
  }

  const runNow = async () => {
    setWorking(true); setMessage('Offsite backup queued…')
    try { await apiRequest('/api/admin/backups/offsite', { method: 'POST' }); await load() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to queue backup') }
    finally { setWorking(false) }
  }

  const remove = async () => {
    if (!window.confirm('Remove the saved B2 credentials and schedule? Existing locked backups remain in Backblaze.')) return
    await apiRequest('/api/admin/settings/backups', { method: 'DELETE' })
    hydrated.current = false; setForm(EMPTY_BACKUP_FORM); setSettings(null); setJobs([]); setMessage('Backup configuration removed.')
  }

  const healthLabel = settings?.health === 'healthy' ? 'Healthy'
    : settings?.health === 'failed' ? 'Needs attention'
      : settings?.health === 'pending' ? 'Waiting for a successful backup'
        : settings?.health === 'disabled' ? 'Automatic backups disabled' : 'Not configured'

  return <>
    <Section title={ui('Encrypted offsite backups')} hint="Backups are encrypted to your public age recipient before upload. Pulpo never receives the private identity.">
      <Field label={ui('Status')} hint={settings?.lastError ?? undefined}>
        <span className={settings?.health === 'failed' ? 'text-xs font-medium text-destructive' : 'text-xs font-medium'}>{healthLabel}</span>
      </Field>
      <Toggle label={ui('Automatic backups')} hint="Enabling queues the first backup immediately." checked={form.enabled} onChange={(value) => update('enabled', value)} />
      <TextField label={ui('B2 S3 endpoint')} placeholder="https://s3.us-west-004.backblazeb2.com" value={form.endpoint} onChange={(value) => update('endpoint', value)} mono />
      <TextField label={ui('Bucket')} value={form.bucket} onChange={(value) => update('bucket', value)} mono />
      <TextField label={ui('File prefix')} value={form.prefix} onChange={(value) => update('prefix', value)} mono />
      <TextField label={ui('Application key ID')} value={form.keyId} onChange={(value) => update('keyId', value)} mono />
      <SecretField label={ui('Application key')} hint={settings?.applicationKeyConfigured ? 'Leave blank to keep the saved key.' : undefined} value={form.applicationKey} onChange={(value) => update('applicationKey', value)} configured={settings?.applicationKeyConfigured} />
      <TextField label={ui('age recipient')} hint="Paste age1… or age1pq1…; never paste AGE-SECRET-KEY…" value={form.recipient} onChange={(value) => update('recipient', value)} mono />
      <SelectField label={ui('Backup interval')} value={String(form.intervalHours)} onChange={(value) => update('intervalHours', Number(value) as 6 | 12 | 24)} options={[
        { value: '6', label: ui('Every 6 hours') }, { value: '12', label: ui('Every 12 hours') }, { value: '24', label: ui('Every 24 hours') },
      ]} />
      <NumField label={ui('Compliance retention')} hint="Applies to future backups and cannot be shortened later." value={form.retentionDays} onChange={(value) => update('retentionDays', Math.round(value))} min={1} max={3000} suffix={ui('days')} />
      <Field label={ui('Next automatic run')}>
        <span className="text-xs tabular-nums">{settings?.nextRunAt ? formatDateTime(Date.parse(settings.nextRunAt)) : '—'}</span>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={working} onClick={() => void test()}><ShieldCheck />{ui('Test connection')}</Button>
          <Button variant="outline" size="sm" disabled={working || !settings?.applicationKeyConfigured} onClick={() => void runNow()}><CloudUpload />{ui('Run now')}</Button>
          {settings?.applicationKeyConfigured && !settings.enabled && <Button variant="ghost" size="sm" onClick={() => void remove()}><Trash2 />{ui('Remove')}</Button>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw />{ui('Refresh')}</Button>
      </div>
      {message && <div className="text-xs text-muted-foreground">{message}</div>}
    </Section>
    <SaveBar onSave={save} />

    <Section title={ui('Offsite backup history')} hint="Recipient fingerprints identify which offline private identity is required for recovery.">
      {jobs.length === 0 ? <div className="text-xs text-muted-foreground">{ui('No offsite backups yet.')}</div> : jobs.map((job) => <div key={job.id} className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm"><span className="capitalize">{job.status.replace('_', ' ')}</span><span className="text-xs text-muted-foreground">{job.trigger}</span></div>
          <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{job.storageEndpoint}/{job.storageBucket}/{job.objectKey}</div>
          <div className="mt-0.5 break-all text-[11px] text-muted-foreground">{formatDateTime(Date.parse(job.createdAt))} · {ui('recipient')} {job.recipientFingerprint ?? '—'} · {ui('locked until')} {job.lockedUntil ? formatDateTime(Date.parse(job.lockedUntil)) : '—'}</div>
          <div className="mt-0.5 break-all text-[11px] text-muted-foreground">{ui('ciphertext')} {job.archiveSizeBytes ?? '—'} {ui('bytes')} · {ui('SHA-256')} {job.archiveChecksum ?? '—'}{job.deletedAt ? ` · ${ui('deleted')} ${formatDateTime(Date.parse(job.deletedAt))}` : ''}</div>
          {job.error && <div className="mt-1 text-xs text-destructive">{job.error}</div>}
        </div>
        {job.status === 'completed' && !job.deletedAt && <Button variant="outline" size="sm" onClick={() => void downloadApiFile(`/api/admin/backups/${job.id}/download`)}><Download />{ui('Encrypted')}</Button>}
      </div>)}
    </Section>
  </>
}

export function DatabaseSection() {
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('')
  const createBackup = async () => { const job = await apiRequest<{ id: string }>('/api/admin/backups', { method: 'POST' }); setStatus('Building backup…'); for (let i = 0; i < 600; i += 1) { await new Promise((resolve) => setTimeout(resolve, 1000)); const result = await apiRequest<{ data: Array<{ id: string; status: string; progress: number; error?: string }> }>('/api/admin/backups'); const current = result.data.find((x) => x.id === job.id); if (current) setStatus(`Backup ${current.progress}%`); if (current?.status === 'completed') { await downloadApiFile(`/api/admin/backups/${job.id}/download`); setStatus('Backup ready'); return } if (current?.status === 'failed') { setStatus(current.error ?? 'Backup failed'); return } } }
  const restore = async () => { if (!restoreFile || confirmation !== 'RESTORE') return; const form = new FormData(); form.append('confirmation', confirmation); form.append('file', restoreFile); setStatus('Uploading and validating restore…'); const response = await authenticatedFetch('/api/admin/restore', { method: 'POST', body: form }); const result = await response.json(); if (!response.ok) { setStatus(result?.error?.message ?? 'Restore failed'); return } for (let i = 0; i < 3600; i += 1) { await new Promise((resolve) => setTimeout(resolve, 1000)); const jobs = await apiRequest<{ data: Array<{ id: string; status: string; progress: number; error?: string }> }>('/api/admin/backups').catch(() => null); const current = jobs?.data.find((x) => x.id === result.id); if (!current) { location.assign('/login'); return } setStatus(`Restore ${current.progress}%`); if (current.status === 'completed') { location.assign('/login'); return } if (current.status === 'failed') { setStatus(current.error ?? 'Restore failed'); return } } }
  return (
    <div>
      <OffsiteBackupSection />
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
