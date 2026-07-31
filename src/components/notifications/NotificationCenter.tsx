import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Notification {
  id: string; type: string; title: string; body: string; data: { chatId?: string }; readAt: string | null; createdAt: string
}

export function NotificationCenter({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<Notification[]>([])
  const load = () => apiRequest<{ data: Notification[] }>('/api/notifications').then((result) => setItems(result.data)).catch(() => undefined)
  useEffect(() => {
    void load()
    const focus = () => void load()
    window.addEventListener('focus', focus)
    const timer = window.setInterval(focus, 30_000)
    return () => { window.removeEventListener('focus', focus); window.clearInterval(timer) }
  }, [])
  const unread = items.filter((item) => !item.readAt).length
  return <Popover onOpenChange={(open) => open && void load()}>
    <PopoverTrigger asChild><button className={cn('relative flex h-8 cursor-pointer items-center overflow-hidden rounded-lg text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent/70', collapsed ? 'w-9' : 'w-full')}>
      <span className="flex size-8 shrink-0 items-center justify-center"><Bell className="size-4" />{unread > 0 && <span className="absolute left-5 top-1 size-2 rounded-full bg-primary" />}</span>
      {!collapsed && <span className="flex-1 text-left">Notifications</span>}{!collapsed && unread > 0 && <span className="mr-2 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{unread}</span>}
    </button></PopoverTrigger>
    <PopoverContent side="right" align="start" className="w-80 p-0"><div className="border-b px-3 py-2 text-sm font-semibold">Notifications</div><div className="max-h-96 overflow-y-auto">
      {!items.length && <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>}
      {items.map((item) => <button key={item.id} className={cn('w-full border-b p-3 text-left last:border-0 hover:bg-accent', !item.readAt && 'bg-primary/5')} onClick={() => {
        void apiRequest(`/api/notifications/${item.id}`, { method: 'PATCH', body: { read: true } }).then(load)
        if (item.data.chatId) navigate(`/c/${item.data.chatId}`)
      }}><div className="text-sm font-medium">{item.title}</div><div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.body}</div></button>)}
    </div></PopoverContent>
  </Popover>
}
