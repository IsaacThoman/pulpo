import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminChatIdFromInput, adminShareTokenFromInput } from '@/features/admin-chat/identifier'
import { apiRequest, ApiError } from '@/lib/api'
import { ui } from '@/i18n/ui'

export function AdminChatsPage() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const open = async () => {
    if (pending.current) return
    setError(null)
    const chatId = adminChatIdFromInput(value)
    if (chatId) {
      navigate(`/admin/chats/${chatId}`)
      return
    }
    const token = adminShareTokenFromInput(value)
    if (!token) {
      setError(ui('Enter a valid chat UUID, Pulpo chat URL, or shared chat URL.'))
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    try {
      const share = await apiRequest<{ chat: { id: string } }>(`/api/shares/${encodeURIComponent(token)}`, { signal: controller.signal })
      if (!controller.signal.aborted) navigate(`/admin/chats/${share.chat.id}`)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof ApiError && cause.status === 404
          ? ui('This shared link is unavailable, expired, or revoked.')
          : ui('Unable to resolve this shared chat. Please try again.'))
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
      pending.current = null
    }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{ui('Open a user chat')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{ui('Access is limited to one chat and requires two-factor authentication.')}</p>
      </div>
      <form className="space-y-3 rounded-xl border bg-card p-5" aria-busy={loading} onSubmit={(event) => { event.preventDefault(); void open() }}>
        <Label htmlFor="admin-chat-identifier">{ui('Chat UUID, chat URL, or shared URL')}</Label>
        <div className="flex gap-2">
          <Input id="admin-chat-identifier" value={value} onChange={(event) => { setValue(event.target.value); setError(null) }} placeholder="https://pulpo.example/share/…" disabled={loading} autoFocus />
          <Button type="submit" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <Search />}{loading ? ui('Loading…') : ui('Continue')}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  )
}
