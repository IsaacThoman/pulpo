import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Ghost, Hourglass, Loader2, Save, SquarePen } from 'lucide-react'
import { useChat } from '@/stores/chat'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { Composer, type ComposerMessageEdit } from '@/components/chat/Composer'
import { ExpiryCountdown } from '@/components/chat/ExpiryCountdown'
import { MessageItem } from '@/components/chat/MessageItem'
import { ModelIcon } from '@/components/ModelIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { apiRequest } from '@/lib/api'
import { resolveDefaultModelId } from '@/lib/default-model'
import { newChatLocationState, type NewChatLocationState } from '@/lib/new-chat-navigation'
import {
  resolveConfiguredChatExpirationPeriod,
  resolveChatLandingBadge,
  type ChatExpirationPeriod,
  type ChatLandingBadge,
} from '@/lib/chat-expiration'
import type { Message } from '@/lib/types'
import { useDesktopChrome } from '@/stores/desktopChrome'
import { useAuth } from '@/stores/auth'
import { isDesktopRuntime } from '@/lib/runtime'
import { ui, uit } from '@/i18n/ui'
import { DesktopActionsTitleBarSlot, DesktopModelTitleBarSlot } from '@/components/desktop/DesktopSidebarTitleBar'

const DEFAULT_SUGGESTED_PROMPTS = [
  { id: '1', translationKey: 'chat.suggestedPrompts.build' },
  { id: '2', translationKey: 'chat.suggestedPrompts.cache' },
  { id: '3', translationKey: 'chat.suggestedPrompts.commit' },
  { id: '4', translationKey: 'chat.suggestedPrompts.models' },
] as const

type SuggestedPrompt = {
  id: string
  label?: string
  message?: string
  translationKey?: (typeof DEFAULT_SUGGESTED_PROMPTS)[number]['translationKey']
}

function ChatHeaderActions({ children, desktop }: { children: ReactNode; desktop: boolean }) {
  return desktop ? <DesktopActionsTitleBarSlot>{children}</DesktopActionsTitleBarSlot> : children
}

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
  badge,
  expirationPeriod,
}: {
  modelId: string
  suggestions: SuggestedPrompt[]
  onPick: (message: string) => void
  badge: ChatLandingBadge
  expirationPeriod: ChatExpirationPeriod | null
}) {
  const { t } = useTranslation()
  const model = getCatalogModel(modelId)
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="relative flex items-center gap-3">
        <div
          aria-hidden={badge?.kind !== 'temporary'}
          aria-label={t('chat.temporaryChatLabel')}
          data-visible={badge?.kind === 'temporary'}
          role="status"
          className="chat-landing-badge-transition absolute inset-x-0 bottom-full mb-3 flex items-center justify-center gap-1.5 px-2 text-center text-xs font-medium text-violet-700 dark:text-violet-300"
        >
          <Ghost className="size-3.5" />
          {t('chat.temporary')}
        </div>
        <div
          aria-hidden={badge?.kind !== 'expiration'}
          aria-label={badge?.kind === 'expiration' && expirationPeriod ? t('chat.expirationBadgeLabel', { period: expirationPeriod }) : undefined}
          data-visible={badge?.kind === 'expiration'}
          role="status"
          className="chat-landing-badge-transition absolute inset-x-0 bottom-full mb-3 flex items-center justify-center gap-1.5 px-2 text-center text-xs font-medium text-teal-600 dark:text-teal-400"
        >
          <Hourglass className="size-3.5" />
          {expirationPeriod ? t('chat.expiresIn', { period: expirationPeriod }) : null}
        </div>
        <ModelIcon model={model} className="size-12" boxed={false} />
        <h1 className="text-3xl font-semibold tracking-tight">{model.name}</h1>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {model.provider === model.inferenceProvider
          ? model.provider
          : uit`${model.provider} · ${model.inferenceProvider}`}
      </p>
      {suggestions.length > 0 && (
        <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
          {suggestions.map((s, i) => (
            <button
              key={`${s.id}-${i}`}
              onClick={() => onPick(s.message ?? '')}
              className={cn(
                'cursor-pointer rounded-xl border bg-card px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:bg-accent',
                badge?.kind === 'temporary' && 'border-dashed !border-violet-500/50 bg-violet-100/80 hover:bg-violet-200/80 dark:!border-violet-600/30 dark:bg-violet-950/30 dark:hover:bg-violet-900/40',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatPage({ adminMode = false }: { adminMode?: boolean }) {
  const { t } = useTranslation()
  const { chatId: routeChatId } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTemporaryChatId = useChat((state) => state.activeTemporaryChatId)
  const chatId = routeChatId ?? activeTemporaryChatId ?? undefined
  const chat = useChat((s) => chatId ? s.chats.find((item) => item.id === chatId) ?? null : null)
  const chatWidth = useSettings((s) => s.chatWidth)
  const defaultModelId = useSettings((s) => s.defaultModelId)
  const automaticChatExpiration = useSettings((s) => s.automaticChatExpiration)
  const newChatAutoExpire = useSettings((s) => s.newChatAutoExpire)
  const instanceReady = useAuth((s) => s.instanceReady)
  const userRole = useAuth((s) => s.user?.role)
  const networkReady = !isDesktopRuntime() || instanceReady
  const models = useCatalog((state) => state.models)
  const routeModelId = params.get('model')
  const navigationState = location.state as NewChatLocationState | null
  const carriedModelId = navigationState?.selectedModelId
  const [temporary, setTemporary] = useState(false)
  const [savingTemporary, setSavingTemporary] = useState(false)
  const [temporaryError, setTemporaryError] = useState<string | null>(null)
  const setDesktopTemporaryChat = useDesktopChrome((state) => state.setTemporaryChat)
  const [messageEdit, setMessageEdit] = useState<ComposerMessageEdit | null>(null)
  const [composerEditActive, setComposerEditActive] = useState(false)
  const [promptConfig, setPromptConfig] = useState<{ enabled: boolean; count: number; prompts: SuggestedPrompt[] }>({
    enabled: true,
    count: 4,
    prompts: [...DEFAULT_SUGGESTED_PROMPTS],
  })

  const chatModelId = chat?.modelId
  const shouldApplyDefaultRef = useRef(!chatId && !routeModelId && !carriedModelId)
  const handledResetRef = useRef<unknown>(null)
  const [modelId, setModelId] = useState(
    () => routeModelId ?? chatModelId ?? carriedModelId ?? resolveDefaultModelId(models, defaultModelId)
  )
  useEffect(() => {
    useChat.getState().setComposerModel(modelId)
  }, [modelId])
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
    } else if (carriedModelId) {
      shouldApplyDefaultRef.current = false
      setModelId(carriedModelId)
    }
  }, [carriedModelId, chatId, chatModelId, routeModelId])

  const resetDefaultToken = navigationState?.resetDefaultModel
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
    if (adminMode || !routeChatId || !chat?.temporary) return
    useChat.getState().abandonTemporaryChat(chat.id)
    navigate('/', { replace: true, state: { resetDefaultModel: crypto.randomUUID() } })
  }, [adminMode, chat, navigate, routeChatId])

  useEffect(() => {
    if (chatId || routeModelId || !shouldApplyDefaultRef.current) return
    const next = resolveDefaultModelId(models, defaultModelId)
    if (next && next !== modelId) setModelId(next)
  }, [chatId, defaultModelId, modelId, models, routeModelId])

  const selectModel = (id: string) => {
    shouldApplyDefaultRef.current = false
    useChat.getState().setComposerModel(id)
    setModelId(id)
  }

  useEffect(() => {
    if (!networkReady) return
    void apiRequest<{ enabled: boolean; count: number; prompts: SuggestedPrompt[] }>('/api/interface/suggested-prompts')
      .then(setPromptConfig)
      .catch(() => {})
  }, [networkReady])

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const temporaryViewVersionRef = useRef(0)
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
    })
  }

  const isEmpty = !chat
  const effectiveNewChatAutoExpire = automaticChatExpiration !== 'disabled' && newChatAutoExpire
  const suggestions = useMemo(
    () => (promptConfig.enabled ? pickSuggestedPrompts(promptConfig.prompts.map((prompt) => {
      if (!prompt.translationKey) return prompt
      const value = t(prompt.translationKey)
      return { ...prompt, label: value, message: value }
    }), promptConfig.count) : []),
    // Re-roll when opening a new empty chat
    // oxlint-disable-next-line react/exhaustive-deps -- chat identity intentionally re-rolls suggestions
    [chatId, isEmpty, promptConfig, t],
  )

  const sendSuggestion = (s: string) => {
    const id = useChat.getState().sendMessage(null, s, modelId, [], temporary, effectiveNewChatAutoExpire)
    if (!temporary) navigate(`/c/${id}`)
  }

  const handleTemporaryControl = async () => {
    setTemporaryError(null)
    if (!chat) {
      setTemporary((value) => !value)
      return
    }
    if (!chat.temporary || chat.expired || savingTemporary) return
    const viewVersion = temporaryViewVersionRef.current
    setSavingTemporary(true)
    try {
      await useChat.getState().persistTemporaryChat(chat.id)
      if (temporaryViewVersionRef.current !== viewVersion) return
      setTemporary(false)
      navigate(`/c/${chat.id}`)
    } catch (error) {
      if (temporaryViewVersionRef.current !== viewVersion) return
      setTemporaryError(error instanceof Error ? error.message : t('chat.temporarySaveError'))
    } finally {
      setSavingTemporary(false)
    }
  }

  const startNewChat = (temporaryByDefault = false) => {
    if (chat?.temporary) {
      temporaryViewVersionRef.current += 1
      useChat.getState().abandonTemporaryChat(chat.id)
    }
    setTemporary(temporaryByDefault)
    setTemporaryError(null)
    setMessageEdit(null)
    setComposerEditActive(false)
    shouldApplyDefaultRef.current = false
    navigate('/', { state: newChatLocationState(true, modelId) })
  }

  const temporaryMode = temporary || Boolean(chat?.temporary)
  const desktopSidebarVisible = useDesktopChrome((state) => state.desktopSidebarVisible)
  useEffect(() => {
    setDesktopTemporaryChat(temporaryMode)
    return () => setDesktopTemporaryChat(false)
  }, [setDesktopTemporaryChat, temporaryMode])
  const showTemporaryControl = !adminMode && !routeChatId && (!chat || chat.temporary)
  const expirationEnabled = chat ? chat.expiresAt !== null : effectiveNewChatAutoExpire
  const showExpirationControl = !temporaryMode && (chat
    ? automaticChatExpiration !== 'disabled' || chat.expiresAt !== null
    : !routeChatId && automaticChatExpiration !== 'disabled')
  const expirationPeriodLabel = resolveConfiguredChatExpirationPeriod(automaticChatExpiration)
  const landingBadge = resolveChatLandingBadge(temporaryMode, effectiveNewChatAutoExpire, automaticChatExpiration)
  const toggleExpiration = () => {
    if (chat) {
      useChat.getState().setChatAutoExpiration(chat.id, !expirationEnabled)
      return
    }
    useSettings.getState().set('newChatAutoExpire', !expirationEnabled)
  }
  const legacyTemporaryRoute = Boolean(!adminMode && routeChatId && chat?.temporary)

  if (legacyTemporaryRoute) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">{t('chat.openingNewChat')}</div>
  }

  if (routeChatId && !chat && userRole === 'admin' && !adminMode) {
    return <div className="grid h-full place-items-center p-6"><div className="max-w-md space-y-3 text-center"><h2 className="text-lg font-semibold">{ui('Chat is not in your account')}</h2><p className="text-sm text-muted-foreground">{ui('If this is a user chat, open the audited administrator access gate.')}</p><button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => navigate(`/admin/chats/${routeChatId}`)}>{ui('Open with admin access')}</button></div></div>
  }

  return (
    <div className={cn(
      'flex h-full min-w-0 flex-col transition-colors duration-200',
      temporaryMode && 'bg-violet-100/50 dark:bg-violet-950/15',
    )} data-desktop-temporary-chat={temporaryMode ? 'true' : undefined}>
      {/* header */}
      <header className="flex h-12 min-w-0 shrink-0 items-center gap-1 px-3">
        {desktopSidebarVisible ? (
          <DesktopModelTitleBarSlot>
            <ModelSelector value={modelId} onChange={selectModel} />
          </DesktopModelTitleBarSlot>
        ) : (
          <ModelSelector value={modelId} onChange={selectModel} />
        )}
        <div className="flex-1" />
        <ChatHeaderActions desktop={desktopSidebarVisible}>
          {showExpirationControl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={expirationEnabled
                  ? t('chat.disableChatExpiry')
                  : expirationPeriodLabel ? t('chat.expireChatIn', { period: expirationPeriodLabel }) : t('chat.enableChatExpiry')}
                aria-pressed={expirationEnabled}
                onClick={toggleExpiration}
              >
                <Hourglass className={cn('size-4', expirationEnabled && 'text-teal-500 dark:text-teal-400')} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {expirationEnabled
                ? chat?.expiresAt
                  ? <>{t('chat.disableExpiry')} <ExpiryCountdown expiresAt={chat.expiresAt} /></>
                  : t('chat.disableChatExpiry')
                : expirationPeriodLabel ? t('chat.expireChatIn', { period: expirationPeriodLabel }) : t('chat.enableChatExpiry')}
            </TooltipContent>
          </Tooltip>
          )}
          {showTemporaryControl && (chat?.temporary ? (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('chat.saveChat')}
                  onClick={() => void handleTemporaryControl()}
                  disabled={savingTemporary || Boolean(chat.expired)}
                >
                  {savingTemporary
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Save className="size-4 text-primary" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{chat.expired ? t('chat.temporaryExpired') : t('chat.saveChat')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={t('chat.newTemporaryChat')}
                  onClick={() => startNewChat(true)}
                >
                  <SquarePen className="size-4 text-primary" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('chat.newTemporaryChat')}</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={temporaryMode ? t('chat.disableTemporary') : t('chat.enableTemporary')}
                onClick={() => void handleTemporaryControl()}
                data-active={temporaryMode}
              >
                <Ghost className={cn('size-4', temporaryMode && 'text-primary')} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{temporaryMode ? t('chat.disableTemporary') : t('chat.enableTemporary')}</TooltipContent>
          </Tooltip>
          ))}
          {!adminMode && chat && !chat.temporary && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('chat.newChat')}
                onClick={() => startNewChat()}
              >
                <SquarePen className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.newChat')}</TooltipContent>
          </Tooltip>
          )}
        </ChatHeaderActions>
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
              badge={landingBadge}
              expirationPeriod={expirationPeriodLabel}
            />
          </div>
          <div
            className={cn(
              'mx-auto w-full shrink-0 px-4 pb-4',
              chatWidth === 'narrow' ? 'max-w-5xl' : 'max-w-[min(100%,90rem)]'
            )}
          >
            <Composer chatId={null} modelId={modelId} temporary={temporaryMode} autoExpire={effectiveNewChatAutoExpire} />
          </div>
        </>
      ) : (
        <>
          <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
            <div
              ref={contentRef}
              className={cn(
                'mx-auto flex w-full min-w-0 flex-col gap-7 px-4 py-6',
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
              <div role="status" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"> {ui("This temporary chat has expired and cannot be recovered. Its existing transcript is available only until you leave this page.")} </div>
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
