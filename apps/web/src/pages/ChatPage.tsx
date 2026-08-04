import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Ghost, Share2 } from 'lucide-react'
import { useChat } from '@/stores/chat'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { Composer } from '@/components/chat/Composer'
import { MessageItem } from '@/components/chat/MessageItem'
import { ModelIcon } from '@/components/ModelIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { apiRequest } from '@/lib/api'
import { resolveDefaultModelId } from '@/lib/default-model'

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
}: {
  modelId: string
  suggestions: SuggestedPrompt[]
  onPick: (message: string) => void
}) {
  const model = getCatalogModel(modelId)
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="flex items-center gap-3">
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
  const { chatId } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const chat = useChat((s) => chatId ? s.chats.find((item) => item.id === chatId) ?? null : null)
  const chatWidth = useSettings((s) => s.chatWidth)
  const defaultModelId = useSettings((s) => s.defaultModelId)
  const models = useCatalog((state) => state.models)
  const routeModelId = params.get('model')
  const [temporary, setTemporary] = useState(params.get('temporary') === '1')
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
    shouldApplyDefaultRef.current = true
    const next = resolveDefaultModelId(models, defaultModelId)
    if (next) setModelId(next)
  }, [defaultModelId, models, resetDefaultToken])

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

  const isEmpty = !chat
  const suggestions = useMemo(
    () => (promptConfig.enabled ? pickSuggestedPrompts(promptConfig.prompts, promptConfig.count) : []),
    // Re-roll when opening a new empty chat
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, isEmpty, promptConfig],
  )

  const sendSuggestion = (s: string) => {
    const id = useChat.getState().sendMessage(null, s, modelId, [], temporary)
    navigate(`/c/${id}`)
  }

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-1 px-3">
        <ModelSelector value={modelId} onChange={selectModel} />
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Temporary chat"
              onClick={() => setTemporary((value) => !value)}
              data-active={temporary}
            >
              <Ghost className={cn('size-4', temporary && 'text-primary')} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Temporary chat</TooltipContent>
        </Tooltip>
        {chat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => void useChat.getState().shareChat(chat.id)
                  .then((url) => navigator.clipboard?.writeText(url))}
                aria-label="Share chat"
              >
                <Share2 className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy share link</TooltipContent>
          </Tooltip>
        )}
      </header>

      {/* body */}
      {isEmpty ? (
        <>
          <div className="min-h-0 flex-1">
            <Placeholder modelId={modelId} suggestions={suggestions} onPick={sendSuggestion} />
          </div>
          <div
            className={cn(
              'mx-auto w-full shrink-0 px-4 pb-4',
              chatWidth === 'narrow' ? 'max-w-5xl' : 'max-w-[min(100%,90rem)]'
            )}
          >
            <Composer chatId={null} modelId={modelId} temporary={temporary} />
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
            <Composer chatId={chat.id} modelId={modelId} />
          </div>
        </>
      )}
    </div>
  )
}
