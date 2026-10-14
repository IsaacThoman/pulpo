import { Hourglass } from 'lucide-react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { resolveChatExpiryMenuAction } from '@/lib/chat-expiration'
import type { Chat } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { useSettings } from '@/stores/settings'
import { ExpiryCountdown } from '@/components/chat/ExpiryCountdown'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

/** Turns a chat's automatic deletion on or off, counting down while it is on. */
export function ChatExpiryMenuItem({ chat }: { chat: Pick<Chat, 'id' | 'expiresAt'> }) {
  const { t } = useTranslation()
  const setChatAutoExpiration = useChat((state) => state.setChatAutoExpiration)
  const automaticChatExpiration = useSettings((state) => state.automaticChatExpiration)
  const action = resolveChatExpiryMenuAction(chat.expiresAt, automaticChatExpiration)
  if (!action) return null
  return (
    <DropdownMenuItem onSelect={() => setChatAutoExpiration(chat.id, action.kind === 'enable')}>
      <Hourglass className={cn(action.kind === 'disable' && 'text-teal-500 dark:text-teal-400')} />
      {action.kind === 'disable' && chat.expiresAt !== null
        ? <span>{t('chat.disableExpiry')} <ExpiryCountdown expiresAt={chat.expiresAt} /></span>
        : action.kind === 'enable' ? action.label : null}
    </DropdownMenuItem>
  )
}
