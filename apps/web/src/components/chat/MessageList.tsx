import { memo, type ComponentProps } from 'react'
import { useChat } from '@/stores/chat'
import type { Message } from '@/lib/types'
import { MessageItem } from './MessageItem'

const EMPTY_MESSAGES: Message[] = []
type MessageListProps = Omit<ComponentProps<typeof MessageItem>, 'message' | 'streaming'>

/** Streaming updates stay inside the transcript instead of re-rendering the composer/header. */
export const MessageList = memo(function MessageList(props: MessageListProps) {
  const messages = useChat((state) => state.chats.find((chat) => chat.id === props.chat.id)?.messages ?? EMPTY_MESSAGES)
  return messages.map((message) => (
    <MessageItem
      key={message.id}
      {...props}
      message={message}
      streaming={message.role === 'assistant' && !message.done}
    />
  ))
})
