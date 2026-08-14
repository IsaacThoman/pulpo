import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
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
import { PendingAttachmentChip } from '@/components/chat/AttachmentImage'
import { cn } from '@/lib/utils'
import { downloadAttachment } from '@/lib/local-first/attachment-cache'
import {
  collectImageFiles,
  collectUploadFiles,
  isSupportedImageMime,
  nonImageAttachmentRestriction,
} from '@/lib/attachments'
import { useAuth } from '@/stores/auth'
import { shouldSubmitComposerKey } from '@/components/chat/composer-keyboard'
import { composerPrimaryAction } from '@/components/chat/composer-queue'
import { canSubmitComposerDraft } from '@/components/chat/composer-upload-policy'
import type { Attachment } from '@/lib/types'
import { useUploadOutbox, type UploadRecord } from '@/stores/upload-outbox'

export interface ComposerMessageEdit {
  messageId: string
  content: string
  attachments: Attachment[]
}

const EMPTY_QUEUE: never[] = []

function downloadComposerAttachment(attachment: UploadRecord): void {
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
  if (userId && attachment.id) void downloadAttachment(userId, {
    id: attachment.id,
    originalName: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size,
  }, useSettings.getState().localAttachmentCacheMb)
}

export function Composer({
  chatId,
  modelId,
  centered,
  temporary = false,
  autoExpire = false,
  messageEdit = null,
  onMessageEditComplete,
  onEditStateChange,
}: {
  chatId: string | null
  modelId: string
  centered?: boolean
  temporary?: boolean
  autoExpire?: boolean
  messageEdit?: ComposerMessageEdit | null
  onMessageEditComplete?: (result: 'saved' | 'cancelled') => void
  onEditStateChange?: (active: boolean) => void
}) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [queueDragId, setQueueDragId] = useState<string | null>(null)
  const [queueDrop, setQueueDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentIdsRef = useRef(attachmentIds)
  const preservedDraftRef = useRef<{ value: string; attachmentIds: string[] } | null>(null)
  const activeRecoveryIdRef = useRef<string | null>(null)
  const activeMessageEditIdRef = useRef<string | null>(null)
  const queueDragIdRef = useRef<string | null>(null)
  attachmentIdsRef.current = attachmentIds

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
  const updateQueuedMessage = useChat((s) => s.updateQueuedMessage)
  const reorderQueuedMessage = useChat((s) => s.reorderQueuedMessage)
  const deleteQueuedMessage = useChat((s) => s.deleteQueuedMessage)
  const editUserMessage = useChat((s) => s.editUserMessage)
  const uploads = useUploadOutbox((s) => s.uploads)
  const addUploadFiles = useUploadOutbox((s) => s.addFiles)
  const addExistingAttachments = useUploadOutbox((s) => s.addExistingAttachments)
  const removeUpload = useUploadOutbox((s) => s.removeUpload)
  const releaseDraftUploads = useUploadOutbox((s) => s.releaseDraftUploads)
  const consumeUploads = useUploadOutbox((s) => s.consumeUploads)
  const stageSubmission = useUploadOutbox((s) => s.stageSubmission)
  const resumeSubmission = useUploadOutbox((s) => s.resumeSubmission)
  const retryUpload = useUploadOutbox((s) => s.retryUpload)
  const discardSubmission = useUploadOutbox((s) => s.discardSubmission)
  const preserveComposerDraft = useUploadOutbox((s) => s.preserveComposerDraft)
  const takePreservedComposerDraft = useUploadOutbox((s) => s.takePreservedComposerDraft)
  const recovery = useUploadOutbox((s) => chatId
    ? s.submissions.find((submission) => submission.chatId === chatId && submission.status === 'recovery') ?? null
    : null)
  const overrides = useModelConfig((s) => s.overrides)
  const generation = useSettings((s) => s.generation)
  const setPresetChoice = useSettings((s) => s.setPresetChoice)
  const agentModeEnabled = useSettings((s) => s.agentModes[modelId] ?? true)
  const setAgentMode = useSettings((s) => s.setAgentMode)
  const agentAvailable = useCatalog((s) => s.agentAvailable)
  const agentCapable = Boolean(getCatalogModel(modelId).agentEnabled)
  const canUseAgent = agentAvailable && agentCapable

  const options = chatOptionsFor(getCatalogModel(modelId), overrides)
  const selections = resolveSelections(options, generation[modelId])
  const activePresets = options.presets.filter((p) => p.choices.length > 0)

  const [editAgentMode, setEditAgentMode] = useState(false)
  const activeAgentMode = messageEdit ? editAgentMode : agentModeEnabled
  const attachments = attachmentIds.map((id) => uploads[id]).filter((item): item is UploadRecord => Boolean(item))
  const uploading = attachments.some((a) => a.status === 'uploading')
  const uploadFailed = attachments.some((a) => a.status === 'error')
  const hasNonImage = attachments.some((a) => !isSupportedImageMime(a.mimeType))
  const attachmentRestriction = nonImageAttachmentRestriction({
    hasNonImage,
    agentModeEnabled: activeAgentMode,
    agentAvailable,
    agentCapable,
  })
  const readyAttachments = attachments.filter((a) => a.status === 'ready' && a.id)
  const hasDraft = value.trim().length > 0 || attachments.length > 0
  const editingExisting = Boolean(messageEdit || editingQueueId)
  const canSend = canSubmitComposerDraft({
    modelId,
    hasText: value.trim().length > 0,
    attachmentCount: attachments.length,
    uploading,
    uploadFailed,
    attachmentRestricted: Boolean(attachmentRestriction),
    submitting,
    editingExisting,
  })

  useEffect(() => {
    ref.current?.focus()
  }, [chatId])

  useEffect(() => {
    onEditStateChange?.(Boolean(editingQueueId || messageEdit || recovery))
  }, [editingQueueId, messageEdit, onEditStateChange, recovery])

  useEffect(() => () => {
    releaseDraftUploads(attachmentIdsRef.current)
    releaseDraftUploads(preservedDraftRef.current?.attachmentIds ?? [])
  }, [releaseDraftUploads])

  const autosize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [])

  const removeAttachment = useCallback((localId: string) => {
    setAttachmentIds((current) => current.filter((id) => id !== localId))
    removeUpload(localId)
  }, [removeUpload])

  const uploadFiles = useCallback((incoming: File[]) => {
    if (!incoming.length) return
    const ids = addUploadFiles(incoming, { chatId, temporary })
    setAttachmentIds((current) => [...current, ...ids])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [addUploadFiles, chatId, temporary])

  const addFiles = useCallback((list: FileList | File[] | DataTransferItemList | null | undefined) => {
    uploadFiles(collectUploadFiles(list))
  }, [uploadFiles])

  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const showDropTarget = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragging(true)
    }
    const allowDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }
    const hideDropTarget = (event: DragEvent) => {
      if (event.relatedTarget !== null) return
      setDragging(false)
    }
    const dropFiles = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragging(false)
      addFiles(event.dataTransfer?.files)
    }

    window.addEventListener('dragenter', showDropTarget)
    window.addEventListener('dragover', allowDrop)
    window.addEventListener('dragleave', hideDropTarget)
    window.addEventListener('drop', dropFiles)
    window.addEventListener('dragend', hideDropTarget)
    return () => {
      window.removeEventListener('dragenter', showDropTarget)
      window.removeEventListener('dragover', allowDrop)
      window.removeEventListener('dragleave', hideDropTarget)
      window.removeEventListener('drop', dropFiles)
      window.removeEventListener('dragend', hideDropTarget)
    }
  }, [addFiles])

  const clearDraft = (release = true) => {
    if (release) releaseDraftUploads(attachmentIds)
    setValue('')
    setAttachmentIds([])
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto'
    })
  }

  const restorePreservedDraft = useCallback(() => {
    const preserved = preservedDraftRef.current
    preservedDraftRef.current = null
    setEditingQueueId(null)
    activeMessageEditIdRef.current = null
    if (!preserved) return
    const preservedIds = new Set(preserved.attachmentIds)
    releaseDraftUploads(attachmentIds.filter((id) => !preservedIds.has(id)))
    setValue(preserved.value)
    setAttachmentIds(preserved.attachmentIds)
    requestAnimationFrame(autosize)
  }, [attachmentIds, autosize, releaseDraftUploads])

  useEffect(() => {
    if (!messageEdit || editingQueueId || activeMessageEditIdRef.current === messageEdit.messageId) return
    preservedDraftRef.current = { value, attachmentIds }
    activeMessageEditIdRef.current = messageEdit.messageId
    setValue(messageEdit.content)
    setEditAgentMode(agentModeEnabled)
    setQueueError(null)
    setAttachmentIds(addExistingAttachments(messageEdit.attachments, { chatId, temporary }))
    requestAnimationFrame(() => {
      autosize()
      ref.current?.focus()
    })
  }, [addExistingAttachments, agentModeEnabled, attachmentIds, autosize, chatId, editingQueueId, messageEdit, temporary, value])

  const cancelMessageEdit = useCallback(() => {
    if (!messageEdit) return
    restorePreservedDraft()
    onMessageEditComplete?.('cancelled')
  }, [messageEdit, onMessageEditComplete, restorePreservedDraft])

  useEffect(() => {
    if (messageEdit || !activeMessageEditIdRef.current) return
    restorePreservedDraft()
  }, [messageEdit, restorePreservedDraft])

  useEffect(() => {
    if (!editingQueueId || queuedMessages.some((message) => message.id === editingQueueId)) return
    restorePreservedDraft()
  }, [editingQueueId, queuedMessages, restorePreservedDraft])

  useEffect(() => {
    if (recovery && !activeRecoveryIdRef.current && !messageEdit && !editingQueueId) {
      preserveComposerDraft(recovery.chatId, { value, attachmentIds })
      activeRecoveryIdRef.current = recovery.id
      setValue(recovery.content)
      setAttachmentIds(recovery.attachmentIds)
      setQueueError(null)
      requestAnimationFrame(() => {
        autosize()
        ref.current?.focus()
      })
      return
    }
    if (recovery || !activeRecoveryIdRef.current) return
    activeRecoveryIdRef.current = null
    if (!chatId) return
    const preserved = takePreservedComposerDraft(chatId)
    if (!preserved) return
    setValue(preserved.value)
    setAttachmentIds(preserved.attachmentIds)
    requestAnimationFrame(autosize)
  }, [attachmentIds, autosize, chatId, editingQueueId, messageEdit, preserveComposerDraft, recovery, takePreservedComposerDraft, value])

  const queuePayload = () => readyAttachments.map((attachment) => ({
    id: attachment.id!,
    name: attachment.name,
    mimeType: attachment.mimeType,
    type: (isSupportedImageMime(attachment.mimeType) ? 'image' : 'file') as 'image' | 'file',
    size: attachment.size,
  }))

  const submit = async () => {
    const text = value.trim()
    if (!canSend) return
    if (!text && attachments.length === 0) return
    const payload = queuePayload()
    const queueInput = {
      input: text,
      modelId,
      presetSelections: selections,
      attachmentIds: payload.map((attachment) => attachment.id),
      agentMode: activeAgentMode && canUseAgent,
    }
    setQueueError(null)
    if (messageEdit && chatId) {
      setSubmitting(true)
      try {
        await editUserMessage({
          chatId,
          messageId: messageEdit.messageId,
          content: text,
          modelId,
          attachments: payload,
          agentMode: activeAgentMode && canUseAgent,
        })
        consumeUploads(attachmentIds)
        restorePreservedDraft()
        onMessageEditComplete?.('saved')
      } catch (error) {
        setQueueError(error instanceof Error ? error.message : 'Unable to save and resend the message')
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (editingQueueId && chatId) {
      setSubmitting(true)
      try {
        await updateQueuedMessage(chatId, editingQueueId, { action: 'save_edit', ...queueInput }, payload)
        consumeUploads(attachmentIds)
        restorePreservedDraft()
      } catch (error) {
        setQueueError(error instanceof Error ? error.message : 'Unable to update queued message')
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (recovery) {
      resumeSubmission(recovery.id, {
        content: text,
        modelId,
        presetSelections: selections,
        agentMode: activeAgentMode && canUseAgent,
        attachmentIds,
      })
      clearDraft(false)
      return
    }
    const staged = stageSubmission({
      chatId,
      content: text,
      modelId,
      presetSelections: selections,
      agentMode: activeAgentMode && canUseAgent,
      temporary,
      autoExpire,
      attachmentIds,
    })
    if (!chatId && staged.chatId && !temporary) navigate(`/c/${staged.chatId}`)
    clearDraft(false)
  }

  const beginQueueEdit = async (messageId: string) => {
    if (!chatId || submitting || messageEdit) return
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
      preservedDraftRef.current = { value, attachmentIds }
      setEditingQueueId(messageId)
      setValue(message.content)
      setAttachmentIds(addExistingAttachments(message.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        size: attachment.sizeBytes,
        mimeType: attachment.mimeType,
        type: isSupportedImageMime(attachment.mimeType) ? 'image' : 'file',
      })), { chatId, temporary }))
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

  const clearQueueDrag = () => {
    queueDragIdRef.current = null
    setQueueDragId(null)
    setQueueDrop(null)
  }

  const startQueueDrag = (messageId: string, event: ReactDragEvent) => {
    queueDragIdRef.current = messageId
    setQueueDragId(messageId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', messageId)
  }

  const dragQueuedMessageOver = (messageId: string, event: ReactDragEvent<HTMLElement>) => {
    const fromId = queueDragIdRef.current
    if (!fromId || fromId === messageId) return
    const moving = queuedMessages.find((message) => message.id === fromId)
    const target = queuedMessages.find((message) => message.id === messageId)
    if (!moving || !target || moving.status === 'dispatching' || target.status === 'dispatching') {
      if (queueDrop) setQueueDrop(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const edge = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    if (queueDrop?.id !== messageId || queueDrop.edge !== edge) setQueueDrop({ id: messageId, edge })
  }

  const moveQueuedMessage = async (messageId: string, targetMessageId: string, edge: 'before' | 'after') => {
    if (!chatId) return
    setQueueError(null)
    setSubmitting(true)
    try {
      await reorderQueuedMessage(chatId, messageId, targetMessageId, edge)
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Unable to reorder queued message')
    } finally {
      setSubmitting(false)
    }
  }

  const onPaste = (event: React.ClipboardEvent) => {
    let files = collectImageFiles(event.clipboardData?.items)
    if (!files.length) files = collectImageFiles(event.clipboardData?.files)
    if (!files.length) return
    // Keep normal text paste when the clipboard also has plain text.
    const text = event.clipboardData?.getData('text/plain') ?? ''
    if (!text.trim()) event.preventDefault()
    uploadFiles(files)
  }

  return (
    <div className={cn('w-full min-w-0', centered && 'px-2')}>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/35 backdrop-grayscale" role="status">
          <div className="flex flex-col items-center gap-3 text-center text-white drop-shadow-sm">
            <ImagePlus className="size-8" aria-hidden="true" />
            <p className="text-base font-medium">Drop files to attach</p>
          </div>
        </div>
      )}
      {attachmentRestriction && (
        <div role="status" className="flex items-center gap-2 px-3 pb-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {attachmentRestriction === 'enable_agent' && 'Non-image files require Agent mode.'}
            {attachmentRestriction === 'model_not_capable' && 'Switch to an Agent-capable model or remove non-image files.'}
            {attachmentRestriction === 'agent_unavailable' && 'Agent mode is unavailable. Remove non-image files to send.'}
          </span>
          {attachmentRestriction === 'enable_agent' && (
            <button
              type="button"
              onClick={() => {
                if (messageEdit) setEditAgentMode(true)
                else setAgentMode(modelId, true)
              }}
              className="shrink-0 cursor-pointer font-medium underline underline-offset-2"
            >
              Enable Agent
            </button>
          )}
        </div>
      )}
      {recovery && (
        <div className={cn(
          'flex items-center gap-2 rounded-t-2xl border border-b-0 px-3 py-2 text-sm shadow-sm',
          uploadFailed || recovery.recoveryError ? 'border-destructive/30 bg-destructive/5' : 'bg-card',
        )}>
          {uploadFailed || recovery.recoveryError
            ? <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
            : <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="min-w-0 flex-1">
            <span className="font-medium">{uploadFailed || recovery.recoveryError ? 'Message needs attention.' : 'Editing pending message.'}</span>{' '}
            <span className="text-muted-foreground">
              {recovery.recoveryError
                ?? (uploadFailed
                  ? 'Retry or remove the failed upload to continue. Later messages will wait.'
                  : uploading
                    ? 'You can resend now; delivery will still wait for its files. Later messages remain queued.'
                    : 'Resend or discard this message to let later messages continue.')}
            </span>
          </span>
          <button
            type="button"
            onClick={() => discardSubmission(recovery.id)}
            className="shrink-0 cursor-pointer text-xs font-medium text-destructive hover:underline"
          >
            Discard
          </button>
        </div>
      )}
      {messageEdit && (
        <div className="flex items-center gap-2 rounded-t-2xl border border-b-0 bg-card px-3 py-2 text-sm shadow-sm">
          <Pencil className="size-3.5 text-muted-foreground" />
          <span className="flex-1 font-medium">Editing message</span>
          <button
            type="button"
            onClick={cancelMessageEdit}
            disabled={submitting}
            className="cursor-pointer text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
      {queuedMessages.length > 0 && (
        <div className={cn(
          'max-h-48 overflow-y-auto border border-b-0 bg-card px-2 pt-2 pb-1 shadow-sm',
          messageEdit ? 'rounded-none' : 'rounded-t-2xl',
        )}>
          {queuedMessages.map((message) => {
            const editing = editingQueueId === message.id
            const anotherEditing = queuedMessages.some((item) => item.status === 'editing' && item.id !== message.id)
            const canReorder = queuedMessages.length > 1 && !submitting && message.status !== 'dispatching'
            const isDragging = queueDragId === message.id
            const showLineBefore = queueDrop?.id === message.id && queueDrop.edge === 'before' && !isDragging
            const showLineAfter = queueDrop?.id === message.id && queueDrop.edge === 'after' && !isDragging
            return (
              <div
                key={message.id}
                draggable={canReorder}
                onDragStart={(event) => {
                  if (canReorder) startQueueDrag(message.id, event)
                }}
                onDragOver={(event) => dragQueuedMessageOver(message.id, event)}
                onDrop={(event) => {
                  event.preventDefault()
                  const fromId = queueDragIdRef.current ?? event.dataTransfer.getData('text/plain')
                  const edge = queueDrop?.id === message.id ? queueDrop.edge : 'before'
                  clearQueueDrag()
                  if (fromId && fromId !== message.id) void moveQueuedMessage(fromId, message.id, edge)
                }}
                onDragEnd={clearQueueDrag}
                className={cn(
                  'relative flex min-h-8 min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-sm',
                  canReorder && 'cursor-grab active:cursor-grabbing',
                  isDragging && 'opacity-40',
                  editing && 'bg-accent ring-1 ring-border',
                  message.status === 'failed' && 'bg-destructive/5',
                )}
              >
                {showLineBefore && (
                  <div className="pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded-full bg-foreground/35" />
                )}
                {showLineAfter && (
                  <div className="pointer-events-none absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground/35" />
                )}
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
                  disabled={submitting || Boolean(messageEdit) || anotherEditing || message.status === 'dispatching'}
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
          (queuedMessages.length > 0 || messageEdit || recovery) && '-mt-px rounded-t-xl',
          temporary && '!border-violet-500/50 bg-violet-100/80 dark:!border-violet-600/50 dark:bg-violet-950/60',
          temporary && 'border-dashed',
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((attachment) => (
              <PendingAttachmentChip
                key={attachment.localId}
                name={attachment.name}
                size={attachment.size}
                mimeType={attachment.mimeType}
                previewUrl={attachment.previewUrl}
                attachmentId={attachment.id}
                sourceFile={attachment.file}
                uploading={attachment.status === 'uploading'}
                error={attachment.status === 'error' ? attachment.error : null}
                onDownload={() => downloadComposerAttachment(attachment)}
                onRetry={attachment.status === 'error' && attachment.file
                  ? () => retryUpload(attachment.localId)
                  : undefined}
                onRemove={() => removeAttachment(attachment.localId)}
              />
            ))}
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
            if (e.key === 'Escape' && messageEdit && !e.nativeEvent.isComposing) {
              e.preventDefault()
              cancelMessageEdit()
              return
            }
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
        <div className="flex min-w-0 items-center gap-1 px-2.5 pb-2.5">
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
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Attach files"
              >
                <Plus className="size-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Attach files</TooltipContent>
          </Tooltip>

          {activePresets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Generation options"
                >
                  {activePresets.map((preset, i) => {
                    const choice = preset.choices.find((c) => c.id === selections[preset.id])
                    const icon = choice?.icon ?? preset.icon
                    return (
                      <span key={preset.id} className="flex min-w-0 items-center gap-1">
                        {i > 0 && <span className="text-border">·</span>}
                        <PresetIcon name={icon} />
                        {choice && <span className="min-w-0 truncate">{choice.displayName}</span>}
                      </span>
                    )
                  })}
                  <ChevronDown className="size-3 shrink-0 opacity-60" />
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
            onClick={() => {
              if (!canUseAgent) return
              if (messageEdit) setEditAgentMode((value) => !value)
              else setAgentMode(modelId, !agentModeEnabled)
            }}
            aria-label={activeAgentMode && canUseAgent ? 'Disable agent mode' : 'Enable agent mode'}
            aria-pressed={activeAgentMode && canUseAgent}
            className={cn('flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40', activeAgentMode && canUseAgent ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
          >
            <Bot className="size-4" />
            <span>Agent</span>
          </button>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Voice input"
              >
                <Mic className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Dictate</TooltipContent>
          </Tooltip>

          {composerPrimaryAction(Boolean(streamingResponseId) && !messageEdit, hasDraft || Boolean(editingQueueId) || Boolean(messageEdit)) === 'stop' ? (
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
              aria-label={messageEdit ? 'Save and resend message' : 'Send message'}
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
