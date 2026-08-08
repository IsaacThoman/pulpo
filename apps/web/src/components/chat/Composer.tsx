import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  CornerDownRight,
  ImagePlus,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Square,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useChat } from '@/stores/chat'
import { useSettings } from '@/stores/settings'
import { chatOptionsFor, resolveSelections, useModelConfig } from '@/stores/modelConfig'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { PresetIcon } from '@/components/chat/PresetIcon'
import { PendingImageChip } from '@/components/chat/AttachmentImage'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'
import { cacheAttachmentBlob, downloadAttachment } from '@/lib/local-first/attachment-cache'
import {
  collectImageFiles,
  collectUploadFiles,
  isSupportedImageFile,
  isSupportedImageMime,
  nonImageAttachmentRestriction,
} from '@/lib/attachments'
import { useAuth } from '@/stores/auth'
import { shouldSubmitComposerKey } from '@/components/chat/composer-keyboard'
import { composerPrimaryAction, shouldQueueComposerMessage } from '@/components/chat/composer-queue'

interface PendingAttachment {
  localId: string
  id?: string
  name: string
  size: number
  mimeType: string
  previewUrl: string | null
  status: 'uploading' | 'ready' | 'error'
  error?: string
  file?: File
}

const EMPTY_QUEUE: never[] = []

function downloadComposerAttachment(attachment: PendingAttachment): void {
  if (attachment.file) {
    const url = URL.createObjectURL(attachment.file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = attachment.file.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return
  }
  const userId = useAuth.getState().user?.id
  if (userId && attachment.id) void downloadAttachment(userId, attachment.id, attachment.name)
}

export function Composer({
  chatId,
  modelId,
  centered,
  temporary = false,
}: {
  chatId: string | null
  modelId: string
  centered?: boolean
  temporary?: boolean
}) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const attachmentsRef = useRef(attachments)
  const preservedDraftRef = useRef<{ value: string; attachments: PendingAttachment[] } | null>(null)
  attachmentsRef.current = attachments

  const sendMessage = useChat((s) => s.sendMessage)
  const streamingResponseId = useChat((s) => {
    if (!chatId) return null
    const chat = s.chats.find((item) => item.id === chatId)
    if (!chat) return null
    const unfinished = chat.messages.filter((message) => message.role === 'assistant' && !message.done)
    return unfinished.find((message) => s.streamingIds.includes(message.id))?.id
      ?? unfinished.at(-1)?.id
      ?? null
  })
  const stopStreaming = useChat((s) => s.stopStreaming)
  const queuedMessages = useChat((s) => chatId
    ? s.chats.find((item) => item.id === chatId)?.queuedMessages ?? EMPTY_QUEUE
    : EMPTY_QUEUE)
  const enqueueMessage = useChat((s) => s.enqueueMessage)
  const updateQueuedMessage = useChat((s) => s.updateQueuedMessage)
  const deleteQueuedMessage = useChat((s) => s.deleteQueuedMessage)
  const overrides = useModelConfig((s) => s.overrides)
  const generation = useSettings((s) => s.generation)
  const setPresetChoice = useSettings((s) => s.setPresetChoice)
  const agentModeEnabled = useSettings((s) => s.agentModeEnabled)
  const setSetting = useSettings((s) => s.set)
  const agentAvailable = useCatalog((s) => s.agentAvailable)
  const agentCapable = Boolean(getCatalogModel(modelId).agentEnabled)
  const canUseAgent = agentAvailable && agentCapable

  const options = chatOptionsFor(getCatalogModel(modelId), overrides)
  const selections = resolveSelections(options, generation[modelId])
  const activePresets = options.presets.filter((p) => p.choices.length > 0)

  const uploading = attachments.some((a) => a.status === 'uploading')
  const uploadFailed = attachments.some((a) => a.status === 'error')
  const hasNonImage = attachments.some((a) => !isSupportedImageMime(a.mimeType))
  const attachmentRestriction = nonImageAttachmentRestriction({
    hasNonImage,
    agentModeEnabled,
    agentAvailable,
    agentCapable,
  })
  const readyAttachments = attachments.filter((a) => a.status === 'ready' && a.id)
  const hasDraft = value.trim().length > 0 || readyAttachments.length > 0
  const canSend = Boolean(modelId) && !uploading && !uploadFailed && !attachmentRestriction && !submitting
    && (value.trim().length > 0 || readyAttachments.length > 0)

  useEffect(() => {
    ref.current?.focus()
  }, [chatId])

  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
    for (const attachment of preservedDraftRef.current?.attachments ?? []) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [])

  const autosize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [])

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((current) => {
      const target = current.find((item) => item.localId === localId)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.localId !== localId)
    })
  }, [])

  const uploadFiles = useCallback(async (incoming: File[]) => {
    if (!incoming.length) return
    const staged: PendingAttachment[] = incoming.map((file) => ({
      localId: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      previewUrl: isSupportedImageFile(file) ? URL.createObjectURL(file) : null,
      status: 'uploading' as const,
      file,
    }))
    setAttachments((current) => [...current, ...staged])

    await Promise.all(staged.map(async (pending, index) => {
      const file = incoming[index]!
      try {
        const created = await apiRequest<{ attachment: { id: string }; uploadUrl: string; uploadHeaders: Record<string, string> }>('/api/attachments', {
          method: 'POST',
          body: {
            chatId,
            originalName: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          },
        })
        const upload = await fetch(created.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: created.uploadHeaders,
          credentials: created.uploadUrl.startsWith('/api/') ? 'include' : 'omit',
        })
        if (!upload.ok) throw new Error(`Upload failed (${upload.status})`)
        const confirmed = await apiRequest<{ mimeType: string }>(`/api/attachments/${created.attachment.id}/confirm`, { method: 'POST' })
        const mimeType = confirmed.mimeType
        const userId = useAuth.getState().user?.id
        if (userId && !temporary) {
          await cacheAttachmentBlob(userId, {
            id: created.attachment.id,
            originalName: file.name,
            mimeType,
            sizeBytes: file.size,
          }, file, useSettings.getState().localAttachmentCacheMb).catch(() => false)
        }
        setAttachments((current) => current.map((item) => (
          item.localId === pending.localId
            ? { ...item, id: created.attachment.id, mimeType, status: 'ready' as const }
            : item
        )))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        setAttachments((current) => current.map((item) => (
          item.localId === pending.localId
            ? { ...item, status: 'error' as const, error: message }
            : item
        )))
      }
    }))

    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [chatId, temporary])

  const addFiles = useCallback((list: FileList | File[] | DataTransferItemList | null | undefined) => {
    void uploadFiles(collectUploadFiles(list))
  }, [uploadFiles])

  const clearDraft = () => {
    setValue('')
    for (const attachment of attachments) if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    setAttachments([])
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto'
    })
  }

  const restorePreservedDraft = useCallback(() => {
    const preserved = preservedDraftRef.current
    preservedDraftRef.current = null
    setEditingQueueId(null)
    if (!preserved) return
    const preservedIds = new Set(preserved.attachments.map((attachment) => attachment.localId))
    for (const attachment of attachments) {
      if (attachment.previewUrl && !preservedIds.has(attachment.localId)) URL.revokeObjectURL(attachment.previewUrl)
    }
    setValue(preserved.value)
    setAttachments(preserved.attachments)
    requestAnimationFrame(autosize)
  }, [attachments, autosize])

  useEffect(() => {
    if (!editingQueueId || queuedMessages.some((message) => message.id === editingQueueId)) return
    restorePreservedDraft()
  }, [editingQueueId, queuedMessages, restorePreservedDraft])

  const queuePayload = () => readyAttachments.map((attachment) => ({
    id: attachment.id!,
    name: attachment.name,
    type: (isSupportedImageMime(attachment.mimeType) ? 'image' : 'file') as 'image' | 'file',
    size: attachment.size,
  }))

  const submit = async () => {
    const text = value.trim()
    if (!canSend) return
    if (!text && readyAttachments.length === 0) return
    const payload = queuePayload()
    const queueInput = {
      input: text,
      modelId,
      presetSelections: selections,
      attachmentIds: payload.map((attachment) => attachment.id),
      agentMode: agentModeEnabled && canUseAgent,
    }
    setQueueError(null)
    if (editingQueueId && chatId) {
      setSubmitting(true)
      try {
        await updateQueuedMessage(chatId, editingQueueId, { action: 'save_edit', ...queueInput }, payload)
        restorePreservedDraft()
      } catch (error) {
        setQueueError(error instanceof Error ? error.message : 'Unable to update queued message')
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (chatId && shouldQueueComposerMessage(Boolean(streamingResponseId), queuedMessages.length)) {
      setSubmitting(true)
      try {
        await enqueueMessage(chatId, queueInput, payload)
        clearDraft()
      } catch (error) {
        setQueueError(error instanceof Error ? error.message : 'Unable to queue message')
      } finally {
        setSubmitting(false)
      }
      return
    }
    const targetChatId = sendMessage(chatId, text, modelId, payload, temporary)
    if (!chatId && targetChatId && !temporary) navigate(`/c/${targetChatId}`)
    clearDraft()
  }

  const beginQueueEdit = async (messageId: string) => {
    if (!chatId || submitting) return
    if (editingQueueId === messageId) {
      setSubmitting(true)
      try {
        await updateQueuedMessage(chatId, messageId, { action: 'cancel_edit' })
        restorePreservedDraft()
      } catch (error) {
        setQueueError(error instanceof Error ? error.message : 'Unable to cancel queue edit')
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (editingQueueId) return
    const message = queuedMessages.find((item) => item.id === messageId)
    if (!message) return
    setSubmitting(true)
    setQueueError(null)
    try {
      await updateQueuedMessage(chatId, messageId, { action: 'begin_edit' })
      preservedDraftRef.current = { value, attachments }
      setEditingQueueId(messageId)
      setValue(message.content)
      setAttachments(message.attachments.map((attachment) => ({
        localId: `queued:${attachment.id}`,
        id: attachment.id,
        name: attachment.name,
        size: attachment.sizeBytes,
        mimeType: attachment.mimeType,
        previewUrl: null,
        status: 'ready' as const,
      })))
      requestAnimationFrame(autosize)
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Unable to edit queued message')
    } finally {
      setSubmitting(false)
    }
  }

  const removeQueuedMessage = async (messageId: string) => {
    if (!chatId || submitting) return
    setSubmitting(true)
    setQueueError(null)
    try {
      await deleteQueuedMessage(chatId, messageId)
      if (editingQueueId === messageId) restorePreservedDraft()
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Unable to delete queued message')
    } finally {
      setSubmitting(false)
    }
  }

  const onDragEnter = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragLeave = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const onPaste = (event: React.ClipboardEvent) => {
    let files = collectImageFiles(event.clipboardData?.items)
    if (!files.length) files = collectImageFiles(event.clipboardData?.files)
    if (!files.length) return
    // Keep normal text paste when the clipboard also has plain text.
    const text = event.clipboardData?.getData('text/plain') ?? ''
    if (!text.trim()) event.preventDefault()
    void uploadFiles(files)
  }

  return (
    <div className={cn('w-full', centered && 'px-2')}>
      {queuedMessages.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-t-2xl border border-b-0 bg-card px-2 pt-2 pb-1 shadow-sm">
          {queuedMessages.map((message) => {
            const editing = editingQueueId === message.id
            const anotherEditing = queuedMessages.some((item) => item.status === 'editing' && item.id !== message.id)
            return (
              <div
                key={message.id}
                className={cn(
                  'flex min-h-8 items-start gap-2 rounded-lg px-2 py-1.5 text-sm',
                  editing && 'bg-accent ring-1 ring-border',
                  message.status === 'failed' && 'bg-destructive/5',
                )}
              >
                <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-foreground/90', editing && 'italic text-muted-foreground')}>
                    {editing
                      ? 'Editing queued message…'
                      : `${message.content || message.attachments.map((attachment) => attachment.name).join(', ')}${message.status === 'editing' ? ' · Editing on another session' : ''}`}
                  </p>
                  {message.attachments.length > 0 && message.content && !editing && (
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Paperclip className="size-3" />
                      {message.attachments.map((attachment) => attachment.name).join(', ')}
                    </p>
                  )}
                  {message.error && <p role="alert" className="truncate text-xs text-destructive">{message.error}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void removeQueuedMessage(message.id)}
                  disabled={submitting || message.status === 'dispatching'}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Delete queued message"
                >
                  <Trash2 className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void beginQueueEdit(message.id)}
                  disabled={submitting || anotherEditing || message.status === 'dispatching'}
                  className={cn(
                    'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
                    editing && 'bg-accent text-foreground',
                  )}
                  aria-label={editing ? 'Cancel queued message edit' : 'Edit queued message'}
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div
        className={cn(
          'relative rounded-2xl border bg-card shadow-sm transition-[background-color,box-shadow,border-color] duration-200 focus-within:shadow-md',
          queuedMessages.length > 0 && '-mt-px rounded-t-xl',
          temporary && 'border-violet-500/70 bg-violet-100/80 dark:border-violet-600/60 dark:bg-violet-950/45',
          temporary && 'border-dashed',
          dragging && 'border-primary ring-2 ring-primary/25',
        )}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/5 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm">
              <ImagePlus className="size-4 text-primary" />
              Drop files to attach
            </div>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((attachment) => (
              <PendingImageChip
                key={attachment.localId}
                name={attachment.name}
                size={attachment.size}
                previewUrl={attachment.previewUrl}
                uploading={attachment.status === 'uploading'}
                error={attachment.status === 'error' ? attachment.error : null}
                onDownload={() => downloadComposerAttachment(attachment)}
                onRemove={() => removeAttachment(attachment.localId)}
              />
            ))}
          </div>
        )}

        {attachmentRestriction && (
          <div role="status" className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1">
              {attachmentRestriction === 'enable_agent' && 'Non-image files require Agent mode.'}
              {attachmentRestriction === 'model_not_capable' && 'Switch to an Agent-capable model or remove non-image files.'}
              {attachmentRestriction === 'agent_unavailable' && 'Agent mode is unavailable. Remove non-image files to send.'}
            </span>
            {attachmentRestriction === 'enable_agent' && (
              <button
                type="button"
                onClick={() => setSetting('agentModeEnabled', true)}
                className="shrink-0 cursor-pointer font-medium underline underline-offset-2"
              >
                Enable Agent
              </button>
            )}
          </div>
        )}

        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autosize()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && editingQueueId && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void beginQueueEdit(editingQueueId)
              return
            }
            if (shouldSubmitComposerKey({
              key: e.key,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
              isComposing: e.nativeEvent.isComposing,
            })) {
              e.preventDefault()
              void submit()
            }
          }}
          onPaste={onPaste}
          rows={1}
          placeholder={attachments.length ? 'Add a caption…' : temporary ? 'Temporary message…' : 'Message…'}
          className="max-h-[220px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => addFiles(event.target.files)}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Attach files"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Attach files</TooltipContent>
          </Tooltip>

          {activePresets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Generation options"
                >
                  {activePresets.map((preset, i) => {
                    const choice = preset.choices.find((c) => c.id === selections[preset.id])
                    const icon = choice?.icon ?? preset.icon
                    return (
                      <span key={preset.id} className="flex items-center gap-1">
                        {i > 0 && <span className="text-border">·</span>}
                        <PresetIcon name={icon} />
                        {choice && <span>{choice.displayName}</span>}
                      </span>
                    )
                  })}
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-48">
                {activePresets.map((preset, i) => (
                  <div key={preset.id}>
                    {i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                      <PresetIcon name={preset.icon} />
                      {preset.name}
                    </DropdownMenuLabel>
                    {preset.choices.map((choice) => (
                      <DropdownMenuItem
                        key={choice.id}
                        onClick={() => setPresetChoice(modelId, preset.id, choice.id)}
                        className="justify-between"
                      >
                        <span className="flex items-center gap-1.5">
                          <PresetIcon name={choice.icon ?? preset.icon} className="opacity-70" />
                          {choice.displayName}
                        </span>
                        {selections[preset.id] === choice.id && <Check className="size-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <button
            type="button"
            disabled={!canUseAgent}
            onClick={() => canUseAgent && setSetting('agentModeEnabled', !agentModeEnabled)}
            aria-label={agentModeEnabled && canUseAgent ? 'Disable agent mode' : 'Enable agent mode'}
            aria-pressed={agentModeEnabled && canUseAgent}
            className={cn('flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40', agentModeEnabled && canUseAgent ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
          >
            <Bot className="size-4" />
            <span>Agent</span>
          </button>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Voice input"
              >
                <Mic className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Dictate</TooltipContent>
          </Tooltip>

          {composerPrimaryAction(Boolean(streamingResponseId), hasDraft || Boolean(editingQueueId)) === 'stop' ? (
            <Button
              size="icon-sm"
              className="rounded-full"
              onClick={() => streamingResponseId && stopStreaming(streamingResponseId)}
              aria-label="Stop generating"
            >
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              className="rounded-full"
              onClick={() => void submit()}
              disabled={!canSend}
              aria-label="Send message"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          )}
        </div>
        {queueError && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{queueError}</p>}
      </div>
    </div>
  )
}
