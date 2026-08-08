import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Ghost, Loader2, Save } from 'lucide-react'
import { useChat } from '@/stores/chat'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { Composer, type ComposerMessageEdit } from '@/components/chat/Composer'
import { MessageItem } from '@/components/chat/MessageItem'
import { ModelIcon } from '@/components/ModelIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { apiRequest } from '@/lib/api'
import { resolveDefaultModelId } from '@/lib/default-model'
import type { Message } from '@/lib/types'

const DEFAULT_SUGGESTED_PROMPTS = [
  { id: '1', label: 'What can you help me build today?', message: 'What can you help me build today?' },
  { id: '2', label: 'Explain how KV caching speeds up decoding', message: 'Explain how KV caching speeds up decoding' },
  { id: '3', label: 'Draft a terse commit message for a sidebar refactor', message: 'Draft a terse commit message for a sidebar refactor' },
  { id: '4', label: 'Compare mixture-of-experts vs dense models', message: 'Compare mixture-of-experts vs dense models' },
]

type SuggestedPrompt = { id: string; label: string; message: string }

function pickSuggestedPrompts(items: SuggestedPrompt[], count: number): SuggestedPrompt[] {
  if (count <= 0 || items.length === 0) return []
  const pool = [...items]
  const out: SuggestedPrompt[] = []
  const unique = Math.min(count, pool.length)
  for (let i = 0; i < unique; i++) {
    const j = Math.floor(Math.random() * pool.length)
    out.push(pool.splice(j, 1)[0]!)
  }
  while (out.length < count) {
    out.push(items[Math.floor(Math.random() * items.length)]!)
  }
  return out
}

function Placeholder({
  modelId,
  suggestions,
  onPick,
  showTemporaryLabel = false,
}: {
  modelId: string
  suggestions: SuggestedPrompt[]
  onPick: (message: string) => void
  showTemporaryLabel?: boolean
}) {
  const model = getCatalogModel(modelId)
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="relative flex items-center gap-3">
        <div
          aria-hidden={!showTemporaryLabel}
          data-visible={showTemporaryLabel}
          className="temporary-label-transition absolute inset-x-0 bottom-full mb-3 flex items-center justify-center gap-1.5 whitespace-nowrap text-xs font-medium text-violet-700 dark:text-violet-300"
        >
          <Ghost className="size-3.5" />
          Temporary
        </div>
        <ModelIcon model={model} className="size-12" boxed={false} />
        <h1 className="text-3xl font-semibold tracking-tight">{model.name}</h1>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {model.provider === model.inferenceProvider
          ? model.provider
          : `${model.provider} · ${model.inferenceProvider}`}
      </p>
      {suggestions.length > 0 && (
        <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
          {suggestions.map((s, i) => (
            <button
              key={`${s.id}-${i}`}
              onClick={() => onPick(s.message)}
              className="cursor-pointer rounded-xl border bg-card px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:bg-accent"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatPage() {
  const { chatId: routeChatId } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTemporaryChatId = useChat((state) => state.activeTemporaryChatId)
  const chatId = routeChatId ?? activeTemporaryChatId ?? undefined
  const chat = useChat((s) => chatId ? s.chats.find((item) => item.id === chatId) ?? null : null)
  const chatWidth = useSettings((s) => s.chatWidth)
  const defaultModelId = useSettings((s) => s.defaultModelId)
  const models = useCatalog((state) => state.models)
  const routeModelId = params.get('model')
  const [temporary, setTemporary] = useState(false)
  const [savingTemporary, setSavingTemporary] = useState(false)
  const [temporaryError, setTemporaryError] = useState<string | null>(null)
  const [messageEdit, setMessageEdit] = useState<ComposerMessageEdit | null>(null)
  const [composerEditActive, setComposerEditActive] = useState(false)
  const [promptConfig, setPromptConfig] = useState<{ enabled: boolean; count: number; prompts: SuggestedPrompt[] }>({
    enabled: true,
    count: 4,
    prompts: DEFAULT_SUGGESTED_PROMPTS,
  })

  const chatModelId = chat?.modelId
  const shouldApplyDefaultRef = useRef(!chatId && !routeModelId)
  const handledResetRef = useRef<unknown>(null)
  const [modelId, setModelId] = useState(
    () => routeModelId ?? chatModelId ?? resolveDefaultModelId(models, defaultModelId)
  )
  useEffect(() => {
    if (chat || models.length === 0 || models.some((model) => model.id === modelId)) return
    setModelId(resolveDefaultModelId(models, defaultModelId))
  }, [chat, defaultModelId, modelId, models])
  useEffect(() => {
    if (chatModelId) {
      shouldApplyDefaultRef.current = false
      setModelId(chatModelId)
    } else if (routeModelId) {
      shouldApplyDefaultRef.current = false
      setModelId(routeModelId)
    }
  }, [chatId, chatModelId, routeModelId])

  const resetDefaultToken = (location.state as { resetDefaultModel?: unknown } | null)?.resetDefaultModel
  useEffect(() => {
    if (!resetDefaultToken || handledResetRef.current === resetDefaultToken) return
    handledResetRef.current = resetDefaultToken
    setTemporary(false)
    setTemporaryError(null)
    shouldApplyDefaultRef.current = true
    const next = resolveDefaultModelId(models, defaultModelId)
    if (next) setModelId(next)
  }, [defaultModelId, models, resetDefaultToken])

  useEffect(() => {
    if (!routeChatId || !chat?.temporary) return
    useChat.getState().abandonTemporaryChat(chat.id)
    navigate('/', { replace: true, state: { resetDefaultModel: crypto.randomUUID() } })
  }, [chat, navigate, routeChatId])

  useEffect(() => {
    if (chatId || routeModelId || !shouldApplyDefaultRef.current) return
    const next = resolveDefaultModelId(models, defaultModelId)
    if (next && next !== modelId) setModelId(next)
  }, [chatId, defaultModelId, modelId, models, routeModelId])

  const selectModel = (id: string) => {
    shouldApplyDefaultRef.current = false
    setModelId(id)
  }

  useEffect(() => {
    void apiRequest<{ enabled: boolean; count: number; prompts: SuggestedPrompt[] }>('/api/interface/suggested-prompts')
      .then(setPromptConfig)
      .catch(() => {})
  }, [])

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    stickToBottomRef.current = true
    const updateStickiness = () => {
      stickToBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96
    }
    const scrollToBottom = () => {
      if (stickToBottomRef.current) viewport.scrollTop = viewport.scrollHeight
    }
    viewport.addEventListener('scroll', updateStickiness, { passive: true })
    const observer = new ResizeObserver(() => window.requestAnimationFrame(scrollToBottom))
    observer.observe(content)
    window.requestAnimationFrame(scrollToBottom)
    return () => {
      viewport.removeEventListener('scroll', updateStickiness)
      observer.disconnect()
    }
  }, [chatId, chat?.id])

  useEffect(() => {
    setMessageEdit(null)
    setComposerEditActive(false)
  }, [chatId])

  const beginMessageEdit = (message: Message) => {
    setMessageEdit({
      messageId: message.id,
      content: message.content,
      attachments: message.attachments ?? [],
      agentMode: Boolean(message.agentMode),
    })
  }

  const isEmpty = !chat
  const suggestions = useMemo(
    () => (promptConfig.enabled ? pickSuggestedPrompts(promptConfig.prompts, promptConfig.count) : []),
    // Re-roll when opening a new empty chat
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, isEmpty, promptConfig],
  )

  const sendSuggestion = (s: string) => {
    const id = useChat.getState().sendMessage(null, s, modelId, [], temporary)
    if (!temporary) navigate(`/c/${id}`)
  }

  const handleTemporaryControl = async () => {
    setTemporaryError(null)
    if (!chat) {
      setTemporary((value) => !value)
      return
    }
    if (!chat.temporary || chat.expired || savingTemporary) return
    setSavingTemporary(true)
    try {
      await useChat.getState().persistTemporaryChat(chat.id)
      setTemporary(false)
      navigate(`/c/${chat.id}`)
    } catch (error) {
      setTemporaryError(error instanceof Error ? error.message : 'Unable to save this chat')
    } finally {
      setSavingTemporary(false)
    }
  }

  const temporaryMode = temporary || Boolean(chat?.temporary)
  const showTemporaryControl = !routeChatId && (!chat || chat.temporary)
  const legacyTemporaryRoute = Boolean(routeChatId && chat?.temporary)

  if (legacyTemporaryRoute) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Opening a new chat…</div>
  }

  return (
    <div className={cn(
      'flex h-full flex-col transition-colors duration-200',
      temporaryMode && 'bg-violet-100/50 dark:bg-violet-950/15',
    )}>
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-1 px-3">
        <ModelSelector value={modelId} onChange={selectModel} />
        <div className="flex-1" />
        {showTemporaryControl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={temporaryMode ? 'Save chat' : 'Temporary chat'}
                onClick={() => void handleTemporaryControl()}
                disabled={savingTemporary || Boolean(chat?.expired)}
                data-active={temporaryMode}
              >
                {savingTemporary
                  ? <Loader2 className="size-4 animate-spin" />
                  : temporaryMode
                    ? <Save className="size-4 text-primary" />
                    : <Ghost className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{chat?.expired ? 'Temporary chat expired' : temporaryMode ? 'Save chat' : 'Temporary chat'}</TooltipContent>
          </Tooltip>
        )}
      </header>

      {temporaryError && (
        <div role="status" className="mx-auto w-full max-w-5xl px-4 pb-2 text-sm text-destructive">
          {temporaryError}
        </div>
      )}

      {/* body */}
      {isEmpty ? (
        <>
          <div className="min-h-0 flex-1">
            <Placeholder
              modelId={modelId}
              suggestions={suggestions}
              onPick={sendSuggestion}
              showTemporaryLabel={temporaryMode}
            />
          </div>
          <div
            className={cn(
              'mx-auto w-full shrink-0 px-4 pb-4',
              chatWidth === 'narrow' ? 'max-w-5xl' : 'max-w-[min(100%,90rem)]'
            )}
          >
            <Composer chatId={null} modelId={modelId} temporary={temporaryMode} />
          </div>
        </>
      ) : (
        <>
          <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
            <div
              ref={contentRef}
              className={cn(
                'mx-auto flex flex-col gap-7 px-4 py-6',
                chatWidth === 'narrow' ? 'max-w-5xl' : 'max-w-[min(100%,90rem)]'
              )}
            >
              {chat.messages.map((m) => (
                <MessageItem
                  key={m.id}
                  chat={chat}
                  message={m}
                  streaming={m.role === 'assistant' && !m.done}
                  activeModelId={modelId}
                  onEditUserMessage={beginMessageEdit}
                  composerEditActive={composerEditActive || Boolean(messageEdit)}
                  editDisabled={chat.messages.some((message) => message.role === 'assistant' && !message.done)}
                />
              ))}
              <div className="h-px" />
            </div>
          </ScrollArea>
          <div
            className={cn(
              'mx-auto w-full shrink-0 px-4 pb-4',
              chatWidth === 'narrow' ? 'max-w-5xl' : 'max-w-[min(100%,90rem)]'
            )}
          >
            {chat.expired ? (
              <div role="status" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                This temporary chat has expired and cannot be recovered. Its existing transcript is available only until you leave this page.
              </div>
            ) : (
              <Composer
                chatId={chat.id}
                modelId={modelId}
                temporary={chat.temporary}
                messageEdit={messageEdit}
                onMessageEditComplete={() => setMessageEdit(null)}
                onEditStateChange={setComposerEditActive}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
