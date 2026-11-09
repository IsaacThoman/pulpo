import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChat, wasStoppedByUser } from '@/stores/chat'
import { ui } from '@/i18n/ui'

type LatestReply = { chatId: string | null; id: string | null; done: boolean; failed: boolean }

/**
 * Tells screen readers when the newest reply starts, finishes, stops or fails. The streamed
 * text itself stays out of the live region so it is not read token by token.
 */
export function GenerationStatus({ chatId }: { chatId: string | null }) {
  const latest = useChat(useShallow((state): LatestReply => {
    const messages = chatId ? state.chats.find((chat) => chat.id === chatId)?.messages : undefined
    const message = messages?.findLast((item) => item.role === 'assistant')
    return { chatId, id: message?.id ?? null, done: message?.done ?? true, failed: Boolean(message?.error) }
  }))
  const previous = useRef<LatestReply | null>(null)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    const before = previous.current
    previous.current = latest
    // Opening another chat, or the first message of a new one, only reports a reply in progress.
    if (!before || before.chatId !== latest.chatId) {
      setAnnouncement(latest.done ? '' : ui('Generating response…'))
      return
    }
    if (!latest.done) {
      if (before.done || before.id !== latest.id) setAnnouncement(ui('Generating response…'))
      return
    }
    if (!latest.id) return
    const stopped = wasStoppedByUser(latest.id)
    if (!before.done) {
      setAnnouncement(stopped ? ui('Generation stopped') : latest.failed ? ui('Response failed') : ui('Response complete'))
    } else if (before.id === latest.id && !before.failed && latest.failed && !stopped) {
      setAnnouncement(ui('Response failed'))
    }
  }, [latest])

  return <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
}
