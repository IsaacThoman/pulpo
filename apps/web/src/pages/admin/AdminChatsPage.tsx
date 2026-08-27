import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminChatIdFromInput } from '@/features/admin-chat/identifier'
import { ui } from '@/i18n/ui'

export function AdminChatsPage() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const open = () => {
    const chatId = adminChatIdFromInput(value)
    if (!chatId) {
      setError(ui('Enter a valid chat UUID or Pulpo chat URL.'))
      return
    }
    navigate(`/admin/chats/${chatId}`)
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{ui('Open a user chat')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{ui('Access is limited to one chat, requires two-factor authentication, and is audited.')}</p>
      </div>
      <form className="space-y-3 rounded-xl border bg-card p-5" onSubmit={(event) => { event.preventDefault(); open() }}>
        <Label htmlFor="admin-chat-identifier">{ui('Chat UUID or URL')}</Label>
        <div className="flex gap-2">
          <Input id="admin-chat-identifier" value={value} onChange={(event) => { setValue(event.target.value); setError(null) }} placeholder="https://pulpo.example/c/…" autoFocus />
          <Button type="submit"><Search />{ui('Continue')}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  )
}
