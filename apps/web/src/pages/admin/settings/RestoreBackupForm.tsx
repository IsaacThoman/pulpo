import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError, apiRequest } from '@/lib/api'
import { ui } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { discardRestoreBackup, readRestoreProgress, uploadRestoreBackup, waitForRestoreRetry } from './restore-upload'

export function RestoreBackupForm() {
  const userId = useAuth((state) => state.user?.id)
  const [file, setFile] = useState<File | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(0)
  const [working, setWorking] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [pending, setPending] = useState<Array<{ id: string; originalName: string }>>([])
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    const request = new AbortController()
    if (userId) void apiRequest<{ data: typeof pending }>('/api/admin/restore/uploads', { signal: request.signal })
      .then((result) => setPending(result.data)).catch(() => undefined)
    return () => request.abort()
  }, [userId])

  const restore = async () => {
    if (!file || !userId || confirmation !== 'RESTORE' || controller.current) return
    const current = new AbortController(); controller.current = current
    setWorking(true); setFinalizing(false); setStatus(ui('Preparing backup upload…'))
    try {
      const id = await uploadRestoreBackup(file, userId, {
        signal: current.signal, onSession: setUploadId,
        onProgress: (bytes) => {
          const percent = Math.floor(bytes / file.size * 100)
          setProgress(percent); setStatus(ui('Uploading backup {{progress}}%', { progress: percent }))
        },
        onFinalizing: () => { setFinalizing(true); setStatus(ui('Upload complete. Validating and restoring backup…')) },
      })
      for (let attempt = 0; attempt < 3600; attempt++) {
        await waitForRestoreRetry(1000, current.signal)
        let session
        try { session = await readRestoreProgress(id, current.signal) } catch (error) {
          if (error instanceof ApiError && error.status === 401) { location.assign('/login'); return }
          if (error instanceof TypeError || (error instanceof ApiError && (error.status >= 500 || error.status === 429))) {
            setStatus(ui('Reconnecting to restore progress…')); await waitForRestoreRetry(5000, current.signal); continue
          }
          throw error
        }
        if (session.job?.status === 'completed') { location.assign('/login'); return }
        if (session.job?.status === 'failed') throw new Error(session.job.error ?? 'Restore failed')
        if (!session.job) throw new Error('Restore status is unavailable. Check the backup history before starting another restore.')
        setStatus(session.job.status === 'queued' ? ui('Backup queued for restore…') : ui('Restoring backup {{progress}}%', { progress: session.job.progress }))
      }
      setStatus(ui('The restore is still running. Check the backup history for its status.'))
    } catch (error) {
      setStatus(current.signal.aborted ? ui('Upload paused. Select the same file and resume when ready.') : error instanceof Error ? error.message : 'Restore failed')
    } finally { controller.current = null; setWorking(false) }
  }

  const discard = async (id = uploadId) => {
    if (!id || !userId) return
    setWorking(true)
    try {
      if (id === uploadId && file) await discardRestoreBackup(id, file, userId)
      else await apiRequest(`/api/admin/restore/uploads/${id}`, { method: 'DELETE' })
      setPending((uploads) => uploads.filter((upload) => upload.id !== id))
      if (id === uploadId) { setUploadId(null); setProgress(0); setFinalizing(false) }
      setStatus(ui('Upload discarded. You can start again.'))
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not discard upload') }
    finally { setWorking(false) }
  }

  return <div className="space-y-3 border-t py-4">
    <div><div className="text-sm font-medium text-destructive">{ui('Recover full application')}</div>
      <p className="mt-1 text-xs text-muted-foreground">{ui('This replaces all durable instance data, invalidates sessions, and returns everyone to login. Validation failures leave the current instance unchanged.')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{ui('Interrupted uploads resume when you select the same file again. Keep this page open during upload. Inactive uploads expire after 24 hours.')}</p>
    </div>
    {pending.filter((upload) => upload.id !== uploadId).map((upload) => <div key={upload.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-xs">
      <div className="min-w-0"><div className="break-all font-medium">{upload.originalName}</div><div className="text-muted-foreground">{ui('Select this file to resume its upload.')}</div></div>
      <Button variant="outline" size="sm" disabled={working} onClick={() => void discard(upload.id)}>{ui('Discard upload')}</Button>
    </div>)}
    <input aria-label={ui('Backup file')} type="file" accept=".tar.gz,application/gzip" disabled={working} onChange={(event) => {
      setFile(event.target.files?.[0] ?? null); setUploadId(null); setProgress(0); setStatus(''); setFinalizing(false)
    }} className="block w-full text-xs" />
    <input aria-label={ui('Restore confirmation')} value={confirmation} disabled={working} onChange={(event) => setConfirmation(event.target.value)} placeholder={ui('Type RESTORE')} className="h-9 w-48 rounded-md border bg-background px-3 text-sm" />
    <div className="flex flex-wrap gap-2">
      <Button variant="destructive" size="sm" disabled={working || !file || confirmation !== 'RESTORE'} onClick={() => void restore()}><Upload />{working ? (finalizing ? ui('Restoring…') : ui('Uploading…')) : uploadId && !finalizing ? ui('Resume restore upload') : ui('Replace and restore')}</Button>
      {working && !finalizing && <Button variant="outline" size="sm" onClick={() => controller.current?.abort()}>{ui('Pause upload')}</Button>}
      {!working && uploadId && <Button variant="outline" size="sm" onClick={() => void discard()}>{ui('Discard upload')}</Button>}
    </div>
    {working && !finalizing && <progress aria-label={ui('Backup upload progress')} value={progress} max={100} className="h-2 w-full" />}
    {status && <div role="status" className="rounded-md border bg-muted/30 p-3 text-xs">{ui(status)}</div>}
  </div>
}
