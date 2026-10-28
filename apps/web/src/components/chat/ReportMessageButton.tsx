import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { MESSAGE_REPORT_CONTEXT_MAX_LENGTH } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getAdminChatGrant, subscribeAdminChatGrant } from '@/features/admin-chat/access'
import { useFileToasts } from '@/features/files/browser/toasts'
import { ui } from '@/i18n/ui'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { ActionButton } from './ActionButton'
import { PulpoFrownIcon } from './PulpoFrownIcon'

/** Reports a message, sharing its chat with administrators, when the instance allows it. */
export function ReportMessageButton({ messageId }: { messageId: string }) {
  const enabled = useAuth((state) => state.messageReportsEnabled)
  const adminChatView = useSyncExternalStore(subscribeAdminChatGrant, getAdminChatGrant, getAdminChatGrant) !== null
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!enabled || adminChatView) return null

  const changeOpen = (next: boolean) => {
    if (busy) return
    if (!next) { setContext(''); setError('') }
    setOpen(next)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/message-reports', { method: 'POST', body: { messageId, context: context.trim() } })
      setContext('')
      setOpen(false)
      useFileToasts.getState().show({ message: ui('Report sent. An admin will review this chat.') })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui('Unable to send the report.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ActionButton label={ui('Report message')} onClick={() => setOpen(true)}>
        <PulpoFrownIcon className="size-3.5" />
      </ActionButton>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            <DialogHeader>
              <DialogTitle>{ui('Report message')}</DialogTitle>
              <DialogDescription>{ui('This shares the whole chat with the administrators of this instance so they can review it.')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor={`message-report-context-${messageId}`}>{ui('What went wrong?')}</Label>
              <Textarea
                id={`message-report-context-${messageId}`}
                autoFocus
                rows={4}
                className="max-h-60"
                placeholder={ui('Add any context that would help an admin (optional)')}
                value={context}
                maxLength={MESSAGE_REPORT_CONTEXT_MAX_LENGTH}
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `message-report-error-${messageId}` : undefined}
                onChange={(event) => { setContext(event.target.value); setError('') }}
              />
              {error && <p id={`message-report-error-${messageId}`} role="alert" className="text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>{ui('Cancel')}</Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {busy ? ui('Sending…') : ui('Share with admin')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
