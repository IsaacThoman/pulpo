import { memo, useCallback, useRef, useEffect, useState, type ComponentProps } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useChat } from '@/stores/chat'
import type { Message } from '@/lib/types'
import { HISTORY_PREFETCH_MESSAGES } from '@/lib/chat-history'
import { useChatHistory } from '@/features/chat/use-chat-history'
import { ui } from '@/i18n/ui'
import { Button } from '@/components/ui/button'
import { MessageItem } from './MessageItem'

const EMPTY_MESSAGES: Message[] = []
type MessageListProps = Omit<ComponentProps<typeof MessageItem>, 'message' | 'streaming'> & { viewport?: HTMLDivElement }
const indexes = new WeakMap<Message[], Map<string, Message>>()
const idsByChat = new Map<string, { messages: Message[]; ids: string[] }>()
function messageIndex(messages: Message[]) {
  let index = indexes.get(messages)
  if (!index) { index = new Map(messages.map(message => [message.id, message])); indexes.set(messages, index) }
  return index
}
function messageIds(chatId: string, messages: Message[]) {
  const previous = idsByChat.get(chatId)
  if (previous?.messages === messages) return previous.ids
  const same = previous && previous.ids.length === messages.length && messages.every((message, i) => message.id === previous.ids[i])
  const ids = same ? previous.ids : messages.map(message => message.id)
  idsByChat.set(chatId, { messages, ids })
  // This index is only an identity optimization; don't retain visited histories indefinitely.
  if (idsByChat.size > 8) idsByChat.delete(idsByChat.keys().next().value!)
  return ids
}

const MessageRow = memo(function MessageRow({ id, ...props }: Omit<MessageListProps, 'viewport'> & { id: string }) {
  const message = useChat(state => messageIndex(state.chats.find(chat => chat.id === props.chat.id)?.messages ?? EMPTY_MESSAGES).get(id))
  return message ? <MessageItem {...props} message={message} streaming={message.role === 'assistant' && !message.done} /> : null
})

type HistoryContext = ReturnType<typeof useChatHistory>
function HistoryHeader({ context }: { context?: HistoryContext }) {
  return <div className="pt-18">{context?.history?.hasMore ? <div className="pb-4 text-center text-xs text-muted-foreground" role="status">
    {context.error
      ? <Button variant="ghost" size="sm" onClick={() => void context.load()}>{ui('Retry loading earlier messages')}</Button>
      : ui('Loading earlier messages…')}
  </div> : null}</div>
}
const historyComponents = { Header: HistoryHeader }

function VirtualMessages({ viewport, ...props }: MessageListProps & { viewport: HTMLDivElement }) {
  const ids = useChat(state => messageIds(props.chat.id, state.chats.find(chat => chat.id === props.chat.id)?.messages ?? EMPTY_MESSAGES))
  useEffect(() => () => { idsByChat.delete(props.chat.id) }, [props.chat.id])
  const list = useRef<VirtuosoHandle>(null)
  const stickToBottom = useRef(true)
  const lineage = useRef({ end: ids.at(-1), version: 0 })
  if (lineage.current.end !== ids.at(-1)) {
    if (lineage.current.end && !ids.includes(lineage.current.end)) {
      lineage.current.version++
      stickToBottom.current = true
    }
    lineage.current.end = ids.at(-1)
  }
  const [readyVersion, setReadyVersion] = useState<number | null>(null)
  const ready = readyVersion === lineage.current.version
  const context = useChatHistory(props.chat.id, ready)
  const { history, loading, error, load } = context
  const bottomFrame = useRef<number | null>(null)
  const currentIds = useRef(ids)
  currentIds.current = ids
  const hasMessages = ids.length > 0
  useEffect(() => {
    const content = viewport.querySelector<HTMLElement>('[data-virtuoso-scroller]')
    if (!content) return
    let width = content.getBoundingClientRect().width
    let anchor: { id: string; offset: number } | undefined
    let captureFrame = 0
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let resizing = false
    const captureAnchor = () => {
      if (resizing || content.getBoundingClientRect().width !== width) return
      const top = viewport.getBoundingClientRect().top
      const row = [...content.querySelectorAll<HTMLElement>('[data-message-id]')]
        .find(row => row.getBoundingClientRect().bottom > top + 48)
      if (row) anchor = { id: row.dataset.messageId!, offset: row.getBoundingClientRect().top - top }
    }
    const onScroll = () => {
      if (resizing || content.getBoundingClientRect().width !== width) return
      stickToBottom.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96
      cancelAnimationFrame(captureFrame)
      captureFrame = requestAnimationFrame(captureAnchor)
    }
    // Capture before the virtualizer measures newly visible rows and corrects its height estimates.
    viewport.addEventListener('scroll', onScroll, { passive: true, capture: true })
    const observer = new ResizeObserver(() => {
      const nextWidth = content.getBoundingClientRect().width
      if (nextWidth === width) return
      width = nextWidth
      resizing = true
      const index = anchor ? currentIds.current.indexOf(anchor.id) : -1
      if (stickToBottom.current) list.current?.scrollToIndex({ index: 'LAST', align: 'end' })
      else if (index >= 0) list.current?.scrollToIndex({ index, align: 'start', offset: -anchor!.offset })
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => { resizing = false; captureAnchor() }, 200)
    })
    observer.observe(content)
    captureAnchor()
    return () => {
      viewport.removeEventListener('scroll', onScroll, true)
      observer.disconnect()
      cancelAnimationFrame(captureFrame)
      clearTimeout(resizeTimer)
      if (bottomFrame.current !== null) cancelAnimationFrame(bottomFrame.current)
    }
  }, [viewport, hasMessages, lineage.current.version])
  const settleBottom = useCallback(() => {
    if (!ready || !stickToBottom.current) return
    if (bottomFrame.current !== null) cancelAnimationFrame(bottomFrame.current)
    bottomFrame.current = requestAnimationFrame(() => {
      if (stickToBottom.current) list.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
    })
  }, [ready])
  const firstIndex = 1 + (history?.offset ?? 0) * 2
  const version = lineage.current.version
  const rangeChanged = useCallback(({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => {
    // Initial measurement/scrolling must finish before a prepend changes the item indices.
    if (!ready) {
      if (endIndex >= firstIndex + ids.length - 1) setReadyVersion(version)
      return
    }
    if (startIndex - firstIndex < HISTORY_PREFETCH_MESSAGES && history?.hasMore && !loading && !error) void load()
  }, [ready, version, ids.length, firstIndex, history?.hasMore, loading, error, load])
  if (!ids.length) return null
  return <Virtuoso
    key={lineage.current.version}
    ref={list}
    totalListHeightChanged={settleBottom}
    data={ids}
    customScrollParent={viewport}
    firstItemIndex={firstIndex}
    initialTopMostItemIndex={{ index: ids.length - 1, align: 'end' }}
    computeItemKey={(_index, id) => id}
    defaultItemHeight={220}
    increaseViewportBy={{ top: 3000, bottom: 1500 }}
    minOverscanItemCount={{ top: 10, bottom: 5 }}
    atBottomThreshold={96}
    followOutput="auto"
    rangeChanged={rangeChanged}
    components={historyComponents}
    context={context}
    itemContent={(_index, id) => <div className={id === ids.at(-1) ? "pb-[53px]" : "pb-7"} data-message-id={id}><MessageRow {...props} id={id} /></div>}
  />
}

/** Rows subscribe by ID; token updates do not reconcile the complete transcript. */
export const MessageList = memo(function MessageList({ viewport, ...props }: MessageListProps) {
  const messages = useChat(state => viewport ? EMPTY_MESSAGES : state.chats.find(chat => chat.id === props.chat.id)?.messages ?? EMPTY_MESSAGES)
  if (viewport) return <VirtualMessages key={props.chat.id} {...props} viewport={viewport} />
  return messages.map(message => <MessageItem key={message.id} {...props} message={message} streaming={message.role === 'assistant' && !message.done} />)
})
