import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { Loader2, MoreHorizontal, SquarePen } from 'lucide-react'
import { Composer, type ComposerMessageEdit } from '@/components/chat/Composer'
import { MessageList } from '@/components/chat/MessageList'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { ModelIcon } from '@/components/ModelIcon'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import { modelSubtitle } from '@/lib/catalog-model'
import { resolveDefaultModelId } from '@/lib/default-model'
import type { Message } from '@/lib/types'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { useChat, type ResponseGenerationSelection } from '@/stores/chat'
import { useSettings } from '@/stores/settings'
import { PanelMenuItems, PanelWindowButtons } from './PanelControls'
import { samePanelContent, useSidePanel, type PanelContent } from './store'
import { locationIsCurrent, mainViewContent } from './use-panel-actions'

type ChatContent = Extract<PanelContent, { kind: 'chat' }>

/** Draft slot for a new chat started in the panel, apart from the main view's new chat. */
const PANEL_NEW_DRAFT = 'panel:new'
const NO_SCOPE: string[] = []

/** A chat beside the main view: its own messages, model, and composer. */
export function ChatPanelView({ content }: { content: ChatContent }) {
  const location = useLocation()
  const chatId = content.id
  const chat = useChat(useShallow((state) => {
    const current = chatId ? state.chats.find((item) => item.id === chatId) : undefined
    return current ? {
      id: current.id, title: current.title, modelId: current.modelId,
      temporary: current.temporary, expired: current.expired, expiresAt: current.expiresAt,
      fileScopeIds: current.fileScopeIds ?? NO_SCOPE,
    } : null
  }))
  const chatsLoaded = useChat((state) => state.chats.length > 0)
  const chatWidth = useSettings((state) => state.chatWidth)
  const defaultModelId = useSettings((state) => state.defaultModelId)
  const automaticChatExpiration = useSettings((state) => state.automaticChatExpiration)
  const newChatAutoExpire = useSettings((state) => state.newChatAutoExpire)
  const models = useCatalog((state) => state.models)
  const [modelId, setModelId] = useState(() => chat?.modelId ?? resolveDefaultModelId(models, defaultModelId))
  const [messageEdit, setMessageEdit] = useState<ComposerMessageEdit | null>(null)
  const [composerEditActive, setComposerEditActive] = useState(false)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const generationControlRef = useRef<{ getSelection: () => ResponseGenerationSelection } | null>(null)
  const focusComposerRef = useRef<{ focus: () => void } | null>(null)

  // One chat is never open twice: the main view wins.
  useEffect(() => {
    if (!chatId || !locationIsCurrent(location)) return
    if (samePanelContent(mainViewContent(location.pathname), content)) useSidePanel.getState().close()
  }, [chatId, content, location])

  useEffect(() => { if (chat?.modelId) setModelId(chat.modelId) }, [chat?.modelId])
  useEffect(() => {
    if (chat || models.length === 0 || models.some((model) => model.id === modelId)) return
    setModelId(resolveDefaultModelId(models, defaultModelId))
  }, [chat, defaultModelId, modelId, models])
  useEffect(() => {
    setMessageEdit(null)
    setComposerEditActive(false)
  }, [chatId])

  const regenerate = useCallback((messageId: string) => {
    const selection = generationControlRef.current?.getSelection()
    if (chatId && selection) useChat.getState().regenerate(chatId, messageId, selection)
  }, [chatId])
  const beginMessageEdit = useCallback((message: Message) => {
    setMessageEdit({ messageId: message.id, content: message.content, attachments: message.attachments ?? [] })
  }, [])
  const openChat = useCallback((id: string) => useSidePanel.getState().open({ kind: 'chat', id }), [])
  // A new chat keeps the folders of the chat it was started from.
  const startNewChat = () => useSidePanel.getState().open({ kind: 'chat', id: null, scopeIds: chat?.fileScopeIds ?? [] })
  const setNewChatScope = (scopeIds: string[]) => useSidePanel.getState().open({ kind: 'chat', id: null, scopeIds })
  const chatStarted = useCallback((id: string) => useSidePanel.getState().open({ kind: 'chat', id }), [])

  const width = chatWidth === 'narrow' ? 'max-w-3xl' : 'max-w-[min(100%,90rem)]'
  const missing = chatId && !chat

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Like the main chat header: no divider, and room under the model name for "Set as default". */}
      <header className="side-panel-header relative z-10 flex h-12 min-w-0 shrink-0 items-start gap-1 px-2 pt-2">
        <div className="min-w-0 flex-1">
          {chat
            ? <h2 className="truncate px-1 text-sm leading-8 font-medium" title={chat.title}>{chat.title || ui("New chat")}</h2>
            : <ModelSelector value={modelId} onChange={setModelId} onSelectClose={() => focusComposerRef.current?.focus()} />}
        </div>
        {chat && !chat.temporary && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={ui("New chat")} onClick={startNewChat}><SquarePen /></Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{ui("New chat")}</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={ui("Panel actions")}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end"><PanelMenuItems content={content} /></DropdownMenuContent>
        </DropdownMenu>
        <PanelWindowButtons content={content} />
      </header>

      {missing ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
          {chatsLoaded ? ui("This chat is no longer available.") : <Loader2 className="size-5 animate-spin" />}
        </div>
      ) : chat ? (
        <>
          <ScrollArea className="min-h-0 flex-1" viewportRef={setViewport}>
            <div className={`mx-auto w-full min-w-0 px-4 ${width}`}>
              {viewport && <MessageList
                viewport={viewport}
                chat={chat}
                onRegenerate={regenerate}
                onEditUserMessage={beginMessageEdit}
                onOpenChat={openChat}
                composerEditActive={composerEditActive || Boolean(messageEdit)}
              />}
            </div>
          </ScrollArea>
          <div className={`mx-auto w-full shrink-0 px-3 pb-3 ${width}`}>
            {chat.expired ? (
              <div role="status" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{ui("This temporary chat has expired and cannot be recovered. Its existing transcript is available only until you leave this page.")}</div>
            ) : (
              <Composer
                key={`panel:${chat.id}`}
                surface="panel"
                generationControlRef={generationControlRef}
                focusControlRef={focusComposerRef}
                chatId={chat.id}
                modelId={modelId}
                onSelectModel={setModelId}
                fileScopeIds={chat.fileScopeIds}
                onFileScopeChange={chat.temporary ? undefined : (ids) => useChat.getState().setChatFileScope(chat.id, ids)}
                temporary={chat.temporary}
                autoExpire={Boolean(chat.expiresAt)}
                messageEdit={messageEdit}
                onMessageEditComplete={() => setMessageEdit(null)}
                onEditStateChange={setComposerEditActive}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <NewChatPlaceholder modelId={modelId} scoped={content.id === null && content.scopeIds.length > 0} />
          <div className={`mx-auto w-full shrink-0 px-3 pb-3 ${width}`}>
            <Composer
              key="panel:new"
              surface="panel"
              draftSlot={PANEL_NEW_DRAFT}
              // The server keeps one shared new-chat draft; this one stays on this device.
              syncEnabled={false}
              focusControlRef={focusComposerRef}
              chatId={null}
              modelId={modelId}
              onSelectModel={setModelId}
              fileScopeIds={content.id === null ? content.scopeIds : NO_SCOPE}
              onFileScopeChange={setNewChatScope}
              autoExpire={automaticChatExpiration !== 'disabled' && newChatAutoExpire}
              onChatStarted={chatStarted}
            />
          </div>
        </>
      )}
    </div>
  )
}

function NewChatPlaceholder({ modelId, scoped }: { modelId: string; scoped: boolean }) {
  const model = getCatalogModel(modelId)
  return (
    <div className="flex min-h-0 flex-1 select-none flex-col items-center justify-center gap-1.5 px-4 text-center">
      <div className="flex items-center gap-2.5">
        <ModelIcon model={model} className="size-9" boxed={false} />
        <h2 className="text-2xl font-semibold tracking-tight">{model.name}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{scoped ? ui("Ask about the files below, or have the agent organize and edit them.") : modelSubtitle(model)}</p>
    </div>
  )
}
