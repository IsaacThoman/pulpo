import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from '@/i18n/useAppTranslation'
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
import { apiRequest } from '@/lib/api'
import { dictationFilename, insertDictationText, preferredDictationMimeType } from '@/lib/dictation'
import { isDesktopRuntime } from '@/lib/runtime'
import { ui, uit } from '@/i18n/ui'
import {
  deleteLocalComposerDraft,
  deleteRemoteComposerDraft,
  detachSyncedDraftAttachments,
  fetchRemoteComposerDraft,
  cacheRemoteDraftFile,
  loadDraftFile,
  loadLocalComposerDraft,
  saveLocalComposerDraft,
  saveRemoteComposerDraft,
  type LocalComposerDraft,
} from '@/lib/local-first/composer-drafts'

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
  onRestoreModel,
  onRestoreAutoExpire,
  draftPersistence = true,
}: {
  chatId: string | null
  modelId: string
  centered?: boolean
  temporary?: boolean
  autoExpire?: boolean
  messageEdit?: ComposerMessageEdit | null
  onMessageEditComplete?: (result: 'saved' | 'cancelled') => void
  onEditStateChange?: (active: boolean) => void
  onRestoreModel?: (modelId: string) => string
  onRestoreAutoExpire?: (enabled: boolean) => void
  draftPersistence?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [dictationError, setDictationError] = useState<string | null>(null)
  const [dictationState, setDictationState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [queueDragId, setQueueDragId] = useState<string | null>(null)
  const [queueDrop, setQueueDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const [draftRetryRevision, setDraftRetryRevision] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentIdsRef = useRef(attachmentIds)
  const preservedDraftRef = useRef<{ value: string; attachmentIds: string[] } | null>(null)
  const activeRecoveryIdRef = useRef<string | null>(null)
  const activeMessageEditIdRef = useRef<string | null>(null)
  const draftEditorIdRef = useRef(crypto.randomUUID())
  const hydratedDraftScopeRef = useRef<string | null>(null)
  const localDraftDirtyRef = useRef(false)
  const appliedRemoteRevisionRef = useRef(0)
  const draftSaveGenerationRef = useRef(0)
  const pendingLocalDraftsRef = useRef(new Map<string, Parameters<typeof saveLocalComposerDraft>[0]>())
  const submissionPendingRef = useRef(false)
  const queueDragIdRef = useRef<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const dictationChunksRef = useRef<Blob[]>([])
  const dictationTimerRef = useRef<number | null>(null)
  const dictationAbortRef = useRef<AbortController | null>(null)
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
  const returnSubmissionToComposer = useUploadOutbox((s) => s.returnSubmissionToComposer)
  const discardSubmission = useUploadOutbox((s) => s.discardSubmission)
  const preserveComposerDraft = useUploadOutbox((s) => s.preserveComposerDraft)
  const takePreservedComposerDraft = useUploadOutbox((s) => s.takePreservedComposerDraft)
  const recovery = useUploadOutbox((s) => chatId
    ? s.submissions.find((submission) => submission.chatId === chatId && submission.status === 'recovery') ?? null
    : null)
  const overrides = useModelConfig((s) => s.overrides)
  const generation = useSettings((s) => s.generation)
  const sendWithEnter = useSettings((s) => s.sendWithEnter)
  const setPresetChoice = useSettings((s) => s.setPresetChoice)
  const agentModeEnabled = useSettings((s) => s.agentModes[modelId] ?? true)
  const setAgentMode = useSettings((s) => s.setAgentMode)
  const agentAvailable = useCatalog((s) => s.agentAvailable)
  const agentCapable = Boolean(getCatalogModel(modelId).agentEnabled)
  const canUseAgent = agentAvailable && agentCapable
  const dictationEnabled = useAuth((s) => s.dictationEnabled)
  const userId = useAuth((s) => s.user?.id)
  const instanceReady = useAuth((s) => s.instanceReady)
  const desktopCanMutate = !isDesktopRuntime() || instanceReady
  const syncDrafts = useSettings((s) => s.syncDrafts)
  const draftScope = chatId ?? 'new'
  const draftHydrationKey = userId ? `${userId}:${draftScope}` : `anonymous:${draftScope}`
  const remoteDraftQuery = useQuery({
    queryKey: ['drafts', userId, draftScope],
    queryFn: () => fetchRemoteComposerDraft(draftScope),
    enabled: Boolean(userId && syncDrafts && !temporary && draftPersistence),
    retry: false,
    refetchOnWindowFocus: true,
  })
  useEffect(() => {
    const retry = () => setDraftRetryRevision((revision) => revision + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])

  const options = chatOptionsFor(getCatalogModel(modelId), overrides)
  const selections = resolveSelections(options, generation[modelId])
  const activePresets = options.presets.filter((p) => p.choices.length > 0)

  const [editAgentMode, setEditAgentMode] = useState(false)
  const activeAgentMode = messageEdit ? editAgentMode : agentModeEnabled
  const attachments = attachmentIds.map((id) => uploads[id]).filter((item): item is UploadRecord => Boolean(item))
  const uploading = attachments.some((a) => a.status === 'uploading')
  const uploadFailed = attachments.some((a) => a.status === 'error')
  const attachmentUploadError = attachments.find((a) => a.status === 'error')?.error
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
  if (userId && draftPersistence && hydratedDraftScopeRef.current === draftHydrationKey && !temporary && !editingExisting && !recovery && !submissionPendingRef.current) {
    pendingLocalDraftsRef.current.set(draftHydrationKey, {
      userId,
      scope: draftScope,
      content: value,
      modelId,
      presetSelections: selections,
      agentMode: activeAgentMode && canUseAgent,
      ...(!chatId ? { autoExpire } : {}),
      uploads: attachments,
      editorId: draftEditorIdRef.current,
      dirty: syncDrafts,
    })
  } else {
    pendingLocalDraftsRef.current.delete(draftHydrationKey)
  }
  const flushLocalDraft = useCallback((key: string) => {
    const snapshot = pendingLocalDraftsRef.current.get(key)
    if (!snapshot) return
    if (snapshot.content.length === 0 && snapshot.uploads.length === 0) {
      void deleteLocalComposerDraft(snapshot.userId, snapshot.scope).catch(() => undefined)
      return
    }
    void saveLocalComposerDraft({
      ...snapshot,
      dirty: localDraftDirtyRef.current,
      serverRevision: appliedRemoteRevisionRef.current || undefined,
    }).catch(() => undefined)
  }, [])
  const canSend = desktopCanMutate && dictationState === 'idle' && canSubmitComposerDraft({
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
    const flush = () => flushLocalDraft(draftHydrationKey)
    const flushWhenHidden = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('blur', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('blur', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flushWhenHidden)
      flush()
    }
  }, [draftHydrationKey, flushLocalDraft])

  useEffect(() => {
    ref.current?.focus()
  }, [chatId])

  useEffect(() => {
    onEditStateChange?.(Boolean(editingQueueId || messageEdit || recovery))
  }, [editingQueueId, messageEdit, onEditStateChange, recovery])

  useEffect(() => () => {
    releaseDraftUploads(preservedDraftRef.current?.attachmentIds ?? [])
  }, [releaseDraftUploads])

  const autosize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [])

  const materializeLocalAttachments = useCallback(async (draft: Pick<LocalComposerDraft, 'attachments'>) => {
    const nextIds: string[] = []
    for (const attachment of draft.attachments) {
      if (attachment.serverId) {
        nextIds.push(...addExistingAttachments([{
          id: attachment.serverId,
          name: attachment.name,
          size: attachment.sizeBytes,
          mimeType: attachment.mimeType,
          type: isSupportedImageMime(attachment.mimeType) ? 'image' : 'file',
        }], { chatId, temporary }))
        continue
      }
      if (!userId) continue
      const file = await loadDraftFile(userId, attachment.localId)
      if (file) nextIds.push(...addUploadFiles([file], { chatId, temporary }))
    }
    return nextIds
  }, [addExistingAttachments, addUploadFiles, chatId, temporary, userId])

  const applyDraft = useCallback(async (draft: LocalComposerDraft) => {
    consumeUploads(attachmentIdsRef.current)
    const restoredModelId = onRestoreModel?.(draft.modelId) ?? draft.modelId
    if (!chatId && draft.autoExpire !== undefined) onRestoreAutoExpire?.(draft.autoExpire)
    if (restoredModelId) {
      const restoredModel = getCatalogModel(restoredModelId)
      const restoredOptions = chatOptionsFor(restoredModel, useModelConfig.getState().overrides)
      useSettings.getState().setGeneration(restoredModelId, resolveSelections(restoredOptions, draft.presetSelections))
      useSettings.getState().setAgentMode(restoredModelId, draft.agentMode && useCatalog.getState().agentAvailable && Boolean(restoredModel.agentEnabled))
    }
    setValue(draft.content)
    const ids = await materializeLocalAttachments(draft)
    setAttachmentIds(ids)
    requestAnimationFrame(autosize)
  }, [autosize, chatId, consumeUploads, materializeLocalAttachments, onRestoreAutoExpire, onRestoreModel])

  useEffect(() => {
    let cancelled = false
    hydratedDraftScopeRef.current = null
    localDraftDirtyRef.current = false
    appliedRemoteRevisionRef.current = 0
    if (!userId || !draftPersistence || temporary) {
      hydratedDraftScopeRef.current = draftHydrationKey
      return
    }
    void loadLocalComposerDraft(userId, draftScope).then(async (draft) => {
      if (cancelled) return
      if (draft && !syncDrafts) draft = await detachSyncedDraftAttachments(userId, draftScope)
      if (draft) {
        localDraftDirtyRef.current = draft.dirty
        appliedRemoteRevisionRef.current = draft.serverRevision ?? 0
        await applyDraft(draft)
      } else {
        consumeUploads(attachmentIdsRef.current)
        setValue('')
        setAttachmentIds([])
      }
      if (!cancelled) hydratedDraftScopeRef.current = draftHydrationKey
    })
    return () => { cancelled = true }
  }, [applyDraft, consumeUploads, draftHydrationKey, draftPersistence, draftScope, syncDrafts, temporary, userId])

  useEffect(() => {
    if (!remoteDraftQuery.isSuccess || hydratedDraftScopeRef.current !== draftHydrationKey || localDraftDirtyRef.current) return
    const remote = remoteDraftQuery.data
    if (!remote) {
      if (!userId || appliedRemoteRevisionRef.current === 0) return
      appliedRemoteRevisionRef.current = 0
      void deleteLocalComposerDraft(userId, draftScope)
      consumeUploads(attachmentIdsRef.current)
      setValue('')
      setAttachmentIds([])
      return
    }
    if (remote.revision <= appliedRemoteRevisionRef.current) return
    appliedRemoteRevisionRef.current = remote.revision
    const local: LocalComposerDraft = {
      content: remote.content,
      modelId: remote.modelId,
      presetSelections: remote.presetSelections,
      agentMode: remote.agentMode,
      autoExpire: remote.autoExpire,
      attachments: remote.attachments.map((attachment) => ({
        localId: crypto.randomUUID(),
        serverId: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      })),
      editorId: remote.editorId,
      serverRevision: remote.revision,
      serverUpdatedAt: remote.updatedAt,
      dirty: false,
      updatedAt: Date.parse(remote.updatedAt),
    }
    void Promise.all(remote.attachments.map((attachment, index) => userId
      ? cacheRemoteDraftFile(userId, local.attachments[index]!.localId, attachment)
      : Promise.resolve())).then(() => applyDraft(local)).then(() => {
      if (!userId) return
      return saveLocalComposerDraft({
      userId,
      scope: draftScope,
      content: local.content,
      modelId: local.modelId,
      presetSelections: local.presetSelections,
      agentMode: local.agentMode,
      autoExpire: local.autoExpire,
      uploads: local.attachments.map((attachment) => ({
        localId: attachment.localId,
        id: attachment.serverId,
        name: attachment.name,
        size: attachment.sizeBytes,
        mimeType: attachment.mimeType,
        previewUrl: null,
        status: 'ready',
        chatId,
        temporary: false,
        managed: false,
        attempt: 0,
      })),
      editorId: local.editorId,
      dirty: false,
      serverRevision: local.serverRevision,
        serverUpdatedAt: local.serverUpdatedAt,
      })
    })
  }, [applyDraft, chatId, consumeUploads, draftHydrationKey, draftScope, remoteDraftQuery.data, remoteDraftQuery.isSuccess, userId])

  const previousSyncDraftsRef = useRef(syncDrafts)
  useEffect(() => {
    const disabled = previousSyncDraftsRef.current && !syncDrafts
    previousSyncDraftsRef.current = syncDrafts
    if (!disabled || !userId || temporary || hydratedDraftScopeRef.current !== draftHydrationKey) return
    void detachSyncedDraftAttachments(userId, draftScope).then((draft) => {
      if (!draft) return
      localDraftDirtyRef.current = false
      appliedRemoteRevisionRef.current = 0
      return applyDraft(draft)
    })
  }, [applyDraft, draftHydrationKey, draftScope, syncDrafts, temporary, userId])

  const temporaryDraftCleanupScopeRef = useRef<string | null>(null)
  useEffect(() => {
    if (!temporary) {
      temporaryDraftCleanupScopeRef.current = null
      return
    }
    if (!userId || !draftPersistence || temporaryDraftCleanupScopeRef.current === draftScope) return
    temporaryDraftCleanupScopeRef.current = draftScope
    void detachSyncedDraftAttachments(userId, draftScope).then(async (draft) => {
      // Recreate attachment uploads as temporary before removing their durable draft assets.
      if (draft) await applyDraft(draft)
      await deleteLocalComposerDraft(userId, draftScope)
      if (syncDrafts) await deleteRemoteComposerDraft(draftScope).catch(() => undefined)
    })
  }, [applyDraft, draftPersistence, draftScope, syncDrafts, temporary, userId])

  const releaseMicrophone = useCallback(() => {
    if (dictationTimerRef.current !== null) window.clearTimeout(dictationTimerRef.current)
    dictationTimerRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
  }, [])

  const transcribeRecording = useCallback(async (blob: Blob, mimeType: string) => {
    setDictationState('transcribing')
    const controller = new AbortController()
    dictationAbortRef.current = controller
    const form = new FormData()
    form.set('file', blob, dictationFilename(mimeType))
    try {
      const result = await apiRequest<{ text: string }>('/api/dictation/transcriptions', {
        method: 'POST', body: form, signal: controller.signal,
      })
      if (!result.text.trim()) throw new Error(ui("No speech was detected in the recording"))
      const textarea = ref.current
      const start = textarea?.selectionStart ?? value.length
      const end = textarea?.selectionEnd ?? start
      setValue((current) => {
        const inserted = insertDictationText(current, result.text, start, end)
        requestAnimationFrame(() => {
          autosize()
          ref.current?.focus()
          ref.current?.setSelectionRange(inserted.cursor, inserted.cursor)
        })
        return inserted.value
      })
    } catch (error) {
      if (!controller.signal.aborted) setDictationError(error instanceof Error ? error.message : 'Unable to transcribe the recording')
    } finally {
      if (dictationAbortRef.current === controller) dictationAbortRef.current = null
      setDictationState('idle')
    }
  }, [autosize, value.length])

  const stopDictation = useCallback(() => {
    if (dictationTimerRef.current !== null) window.clearTimeout(dictationTimerRef.current)
    dictationTimerRef.current = null
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const startDictation = useCallback(async () => {
    setDictationError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setDictationError(ui("This browser does not support microphone recording"))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredType = preferredDictationMimeType()
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream)
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      dictationChunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size > 0) dictationChunksRef.current.push(event.data) }
      recorder.onerror = () => {
        dictationChunksRef.current = []
        setDictationError(ui("Microphone recording failed"))
        releaseMicrophone()
        setDictationState('idle')
      }
      recorder.onstop = () => {
        const chunks = dictationChunksRef.current
        dictationChunksRef.current = []
        mediaRecorderRef.current = null
        releaseMicrophone()
        if (chunks.length === 0) {
          setDictationState('idle')
          return
        }
        const mimeType = recorder.mimeType || preferredType || 'audio/webm'
        void transcribeRecording(new Blob(chunks, { type: mimeType }), mimeType)
      }
      recorder.start()
      setDictationState('recording')
      dictationTimerRef.current = window.setTimeout(() => stopDictation(), 90_000)
    } catch (error) {
      releaseMicrophone()
      setDictationState('idle')
      setDictationError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone permission was denied'
        : 'Unable to access the microphone')
    }
  }, [releaseMicrophone, stopDictation, transcribeRecording])

  useEffect(() => () => {
    dictationAbortRef.current?.abort()
    const recorder = mediaRecorderRef.current
    if (recorder) recorder.onstop = null
    if (recorder?.state !== 'inactive') recorder?.stop()
    releaseMicrophone()
  }, [releaseMicrophone])

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

  useEffect(() => {
    if (!userId || !draftPersistence || hydratedDraftScopeRef.current !== draftHydrationKey) return
    if (temporary) {
      return
    }
    if (editingExisting || recovery || submissionPendingRef.current) return
    if (value.length > 0 || attachments.length > 0) localDraftDirtyRef.current = syncDrafts
    const generation = ++draftSaveGenerationRef.current
    const timer = window.setTimeout(() => {
      if (value.length === 0 && attachments.length === 0) {
        localDraftDirtyRef.current = false
        appliedRemoteRevisionRef.current = 0
        void deleteLocalComposerDraft(userId, draftScope)
        if (syncDrafts) void deleteRemoteComposerDraft(draftScope).catch(() => undefined)
        return
      }
      const hasPendingAttachments = attachments.some((attachment) => attachment.status !== 'ready' || !attachment.id)
      localDraftDirtyRef.current = syncDrafts
      void saveLocalComposerDraft({
        userId,
        scope: draftScope,
        content: value,
        modelId,
        presetSelections: selections,
        agentMode: activeAgentMode && canUseAgent,
        ...(!chatId ? { autoExpire } : {}),
        uploads: attachments,
        editorId: draftEditorIdRef.current,
        dirty: syncDrafts,
        serverRevision: appliedRemoteRevisionRef.current || undefined,
      })
      const readyIds = attachments.flatMap((attachment) => attachment.status === 'ready' && attachment.id ? [attachment.id] : [])
      if (!syncDrafts || (value.length === 0 && readyIds.length === 0)) return
      void saveRemoteComposerDraft(draftScope, {
        content: value,
        modelId,
        presetSelections: selections,
        agentMode: activeAgentMode && canUseAgent,
        ...(!chatId ? { autoExpire } : {}),
        attachmentIds: readyIds,
        editorId: draftEditorIdRef.current,
      }).then((remote) => {
        if (draftSaveGenerationRef.current !== generation) return
        appliedRemoteRevisionRef.current = remote.revision
        localDraftDirtyRef.current = hasPendingAttachments
        return saveLocalComposerDraft({
          userId,
          scope: draftScope,
          content: value,
          modelId,
          presetSelections: selections,
          agentMode: activeAgentMode && canUseAgent,
          ...(!chatId ? { autoExpire } : {}),
          uploads: attachments,
          editorId: draftEditorIdRef.current,
          dirty: hasPendingAttachments,
          serverRevision: remote.revision,
          serverUpdatedAt: remote.updatedAt,
        })
      }).catch(() => undefined)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeAgentMode, attachments, autoExpire, canUseAgent, chatId, draftHydrationKey, draftPersistence, draftRetryRevision, draftScope, editingExisting, modelId, recovery, selections, syncDrafts, temporary, userId, value])

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
      submissionPendingRef.current = false
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
    submissionPendingRef.current = true
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
    if (message.pendingSubmissionId) {
      returnSubmissionToComposer(message.pendingSubmissionId)
      return
    }
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
    const message = queuedMessages.find((item) => item.id === messageId)
    if (message?.pendingSubmissionId) {
      discardSubmission(message.pendingSubmissionId)
      return
    }
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
            <p className="text-base font-medium">{t('chat.attachFiles')}</p>
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
            > {ui("Enable Agent")} </button>
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
            <span className="font-medium">{uploadFailed || recovery.recoveryError ? ui("Message needs attention.") : ui("Editing pending message.")}</span>{' '}
            <span className="text-muted-foreground">
              {recovery.recoveryError
                ?? (uploadFailed
                  ? ui("Retry or remove the failed upload to continue. Later messages will wait.")
                  : uploading
                    ? ui("You can resend now; delivery will still wait for its files. Later messages remain queued.")
                    : ui("Resend or discard this message to let later messages continue."))}
            </span>
          </span>
          <button
            type="button"
            onClick={() => discardSubmission(recovery.id)}
            className="shrink-0 cursor-pointer text-xs font-medium text-destructive hover:underline"
          > {ui("Discard")} </button>
        </div>
      )}
      {messageEdit && (
        <div className="flex items-center gap-2 rounded-t-2xl border border-b-0 bg-card px-3 py-2 text-sm shadow-sm">
          <Pencil className="size-3.5 text-muted-foreground" />
          <span className="flex-1 font-medium">{ui("Editing message")}</span>
          <button
            type="button"
            onClick={cancelMessageEdit}
            disabled={submitting}
            className="cursor-pointer text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          > {ui("Cancel")} </button>
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
            const hasPendingOutboxItem = queuedMessages.some((item) => Boolean(item.pendingSubmissionId))
            const canReorder = queuedMessages.length > 1
              && !hasPendingOutboxItem
              && !submitting
              && message.status !== 'dispatching'
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
                  {(editing || message.content) && (
                    <p className={cn('truncate text-foreground/90', editing && 'italic text-muted-foreground')}>
                      {editing
                        ? ui("Editing queued message…")
                        : uit`${message.content}${message.status === 'editing' ? ' · Editing on another session' : ''}`}
                    </p>
                  )}
                  {message.attachments.length > 0 && !editing && (
                    <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
                      {message.attachments.map((attachment) => {
                        const upload = attachment.localUploadId ? uploads[attachment.localUploadId] : undefined
                        const uploadStatus = upload?.status
                        return (
                          <span
                            key={attachment.localUploadId ?? attachment.id}
                            className="flex min-w-0 items-center gap-1"
                            role={uploadStatus === 'uploading' ? 'status' : undefined}
                            aria-label={uploadStatus === 'uploading' ? uit`Uploading ${attachment.name}` : undefined}
                            title={attachment.name}
                          >
                            {uploadStatus === 'uploading' ? (
                              <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
                            ) : uploadStatus === 'error' ? (
                              <AlertCircle className="size-3 shrink-0 text-destructive" aria-hidden="true" />
                            ) : (
                              <Paperclip className="size-3 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">{attachment.name}</span>
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {message.error && <p role="alert" className="truncate text-xs text-destructive">{message.error}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void removeQueuedMessage(message.id)}
                  disabled={submitting || message.status === 'dispatching'}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={ui("Delete queued message")}
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
                  aria-label={editing ? ui("Cancel queued message edit") : ui("Edit queued message")}
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
          <div className="space-y-2 px-3 pt-3">
            <div className="flex flex-wrap gap-2">
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
            {attachmentUploadError && <p role="alert" className="px-1 text-xs text-destructive">{attachmentUploadError}</p>}
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
              shiftKey: e.shiftKey,
              isComposing: e.nativeEvent.isComposing,
            }, sendWithEnter)) {
              e.preventDefault()
              void submit()
            }
          }}
          onPaste={onPaste}
          rows={1}
          placeholder={attachments.length ? t('chat.addCaption') : temporary ? t('chat.temporaryMessage') : t('chat.message')}
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
                aria-label={t('chat.attachFiles')}
              >
                <Plus className="size-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('chat.attachFiles')}</TooltipContent>
          </Tooltip>

          {activePresets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={t('chat.generationOptions')}
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
            aria-label={activeAgentMode && canUseAgent ? t('chat.disableAgent') : t('chat.enableAgent')}
            aria-pressed={activeAgentMode && canUseAgent}
            className={cn('flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40', activeAgentMode && canUseAgent ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
          >
            <Bot className="size-4" />
            <span>{t('chat.agent')}</span>
          </button>

          <div className="flex-1" />

          {dictationEnabled && <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={!desktopCanMutate || dictationState === 'transcribing'}
                onClick={() => dictationState === 'recording' ? stopDictation() : void startDictation()}
                className={cn('flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60', dictationState === 'recording' && 'bg-destructive/10 text-destructive')}
                aria-label={dictationState === 'recording' ? t('chat.stopDictation') : dictationState === 'transcribing' ? t('chat.transcribing') : t('chat.dictate')}
                aria-pressed={dictationState === 'recording'}
              >
                {dictationState === 'transcribing' ? <Loader2 className="size-4 animate-spin" /> : <Mic className={cn('size-4', dictationState === 'recording' && 'animate-pulse')} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{dictationState === 'recording' ? t('chat.stopDictation') : dictationState === 'transcribing' ? t('chat.transcribing') : t('chat.dictate')}</TooltipContent>
          </Tooltip>}

          {composerPrimaryAction(Boolean(streamingResponseId) && !messageEdit, hasDraft || Boolean(editingQueueId) || Boolean(messageEdit)) === 'stop' ? (
            <Button
              size="icon-sm"
              className="rounded-full"
              disabled={!desktopCanMutate}
              onClick={() => streamingResponseId && stopStreaming(streamingResponseId)}
              aria-label={t('chat.stopGenerating')}
            >
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              className="rounded-full"
              onClick={() => void submit()}
              disabled={!canSend}
              aria-label={messageEdit ? t('chat.saveAndResend') : t('chat.sendMessage')}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          )}
        </div>
        {queueError && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{queueError}</p>}
        {dictationError && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{dictationError}</p>}
      </div>
    </div>
  )
}
