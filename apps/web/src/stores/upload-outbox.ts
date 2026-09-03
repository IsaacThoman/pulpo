import { create } from 'zustand'
import { attachmentValidationError } from '@pulpo/client-core'
import type { Attachment } from '@/lib/types'
import { apiRequest, authenticatedFetch } from '@/lib/api'
import { attachmentUploadErrorMessage } from '@/lib/attachment-upload-error'
import { isSupportedImageFile, isSupportedImageMime, nonImageAttachmentRestriction } from '@/lib/attachments'
import { cacheAttachmentBlob } from '@/lib/local-first/attachment-cache'
import { getCatalogModel, useCatalog } from '@/stores/catalog'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { useChat, waitForResponseDispatch } from '@/stores/chat'
import { optimisticSubmissionPlacement, uploadOutboxHeadAction } from '@/components/chat/composer-upload-policy'
import { ui } from '@/i18n/ui'
import {
  deleteLocalComposerDraft,
  deleteRemoteComposerDraft,
  loadLocalComposerDraft,
  saveLocalComposerTombstone,
} from '@/lib/local-first/composer-drafts'

export type UploadStatus = 'uploading' | 'ready' | 'error'

export interface UploadRecord {
  localId: string
  id?: string
  name: string
  size: number
  mimeType: string
  previewUrl: string | null
  status: UploadStatus
  error?: string
  file?: File
  chatId: string | null
  temporary: boolean
  managed: boolean
  attempt: number
}

export interface PendingSubmission {
  id: string
  chatId: string
  responseId: string
  content: string
  modelId: string
  presetSelections: Record<string, string>
  agentMode: boolean
  temporary: boolean
  autoExpire: boolean
  attachmentIds: string[]
  createdAt: number
  placement: 'bubble' | 'queue'
  status: 'waiting' | 'dispatching' | 'recovery'
  recoveryError?: string
  draftScope: string
  clearDraftOnSuccess: boolean
}

interface AddFilesOptions {
  chatId: string | null
  temporary: boolean
}

interface SubmissionDraft {
  chatId: string | null
  content: string
  modelId: string
  presetSelections: Record<string, string>
  agentMode: boolean
  temporary: boolean
  autoExpire: boolean
  attachmentIds: string[]
}

export interface PreservedComposerDraft {
  value: string
  attachmentIds: string[]
}

interface UploadOutboxState {
  uploads: Record<string, UploadRecord>
  submissions: PendingSubmission[]
  preservedDrafts: Record<string, PreservedComposerDraft>
  addFiles: (files: File[], options: AddFilesOptions) => string[]
  addExistingAttachments: (attachments: Attachment[], options: AddFilesOptions) => string[]
  stageSubmission: (draft: SubmissionDraft) => { chatId: string; submissionId: string }
  retainDraftAfterSubmission: (scope: string) => void
  resumeSubmission: (submissionId: string, draft: Omit<SubmissionDraft, 'chatId' | 'temporary' | 'autoExpire'>) => void
  returnSubmissionToComposer: (submissionId: string) => void
  discardSubmission: (submissionId: string) => void
  preserveComposerDraft: (chatId: string, draft: PreservedComposerDraft) => void
  takePreservedComposerDraft: (chatId: string) => PreservedComposerDraft | null
  retryUpload: (localId: string) => void
  removeUpload: (localId: string) => void
  releaseDraftUploads: (localIds: string[]) => void
  consumeUploads: (localIds: string[]) => void
}

function pendingAttachment(record: UploadRecord): Attachment {
  return {
    id: record.id ?? `local:${record.localId}`,
    name: record.name,
    mimeType: record.mimeType,
    type: isSupportedImageMime(record.mimeType) ? 'image' : 'file',
    size: record.size,
    localUploadId: record.localId,
  }
}

function readyAttachment(record: UploadRecord): Attachment | null {
  if (!record.id || record.status !== 'ready') return null
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    type: isSupportedImageMime(record.mimeType) ? 'image' : 'file',
    size: record.size,
  }
}

function renderSubmissionSurface(submission: PendingSubmission, records: UploadRecord[]): void {
  const attachments = records.map(pendingAttachment)
  if (submission.placement === 'bubble') {
    useChat.getState().stagePendingMessage({
      chatId: submission.chatId,
      responseId: submission.responseId,
      content: submission.content,
      modelId: submission.modelId,
      attachments,
      temporary: submission.temporary,
      autoExpire: submission.autoExpire,
      createdAt: submission.createdAt,
    })
    return
  }
  useChat.getState().stagePendingQueuedMessage({
    chatId: submission.chatId,
    responseId: submission.responseId,
    content: submission.content,
    modelId: submission.modelId,
    presetSelections: submission.presetSelections,
    agentMode: submission.agentMode,
    attachments,
    temporary: submission.temporary,
    autoExpire: submission.autoExpire,
    createdAt: submission.createdAt,
  })
}

function uploadChatId(record: UploadRecord): string | null {
  if (!record.chatId) return null
  const chat = useChat.getState().chats.find((item) => item.id === record.chatId)
  return chat?.provisional ? null : record.chatId
}

function deleteRemoteAttachment(id: string): void {
  void apiRequest(`/api/attachments/${id}`, { method: 'DELETE' }).catch(() => undefined)
}

function referencedChatIds(localId: string): string[] {
  return [...new Set(useUploadOutbox.getState().submissions
    .filter((submission) => submission.attachmentIds.includes(localId))
    .map((submission) => submission.chatId))]
}

function scheduleChat(chatId: string): void {
  queueMicrotask(() => void processChat(chatId))
}

function clearSubmissionDraft(submission: PendingSubmission): void {
  if (!submission.clearDraftOnSuccess) return
  const userId = useAuth.getState().user?.id
  const syncDrafts = useSettings.getState().syncDrafts
  const editorId = `web-submission:${submission.id}`
  if (userId && syncDrafts) {
    void (async () => {
      const existing = await loadLocalComposerDraft(userId, submission.draftScope)
      await saveLocalComposerTombstone({
        userId,
        scope: submission.draftScope,
        editorId,
        dirty: true,
        serverRevision: existing?.serverRevision,
      })
      const revision = await deleteRemoteComposerDraft(submission.draftScope, editorId)
      const current = await loadLocalComposerDraft(userId, submission.draftScope)
      if (!current?.deleted || current.editorId !== editorId) return
      await saveLocalComposerTombstone({
        userId,
        scope: submission.draftScope,
        editorId,
        dirty: false,
        serverRevision: revision,
      })
    })().catch(() => undefined)
  } else if (userId) {
    void deleteLocalComposerDraft(userId, submission.draftScope).catch(() => undefined)
  }
  if (syncDrafts && !userId) void deleteRemoteComposerDraft(submission.draftScope, editorId).catch(() => undefined)
}

async function uploadRecord(localId: string, attempt: number): Promise<void> {
  const initial = useUploadOutbox.getState().uploads[localId]
  if (!initial?.file || initial.attempt !== attempt) return
  const file = initial.file
  let reservedId: string | undefined
  try {
    const validation = attachmentValidationError({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    }, useAuth.getState().maxAttachmentBytes)
    if (validation) throw new Error(validation)

    const created = await apiRequest<{
      attachment: { id: string }
      uploadUrl: string
      uploadHeaders: Record<string, string>
    }>('/api/attachments', {
      method: 'POST',
      body: {
        chatId: uploadChatId(initial),
        originalName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      },
    })
    reservedId = created.attachment.id
    const current = useUploadOutbox.getState().uploads[localId]
    if (!current || current.attempt !== attempt) {
      deleteRemoteAttachment(reservedId)
      return
    }
    useUploadOutbox.setState((state) => ({
      uploads: { ...state.uploads, [localId]: { ...state.uploads[localId]!, id: reservedId } },
    }))

    const upload = await authenticatedFetch(created.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: created.uploadHeaders,
      credentials: created.uploadUrl.startsWith('/api/') ? 'include' : 'omit',
    })
    if (!upload.ok) throw new Error(`Upload failed (${upload.status})`)
    const confirmed = await apiRequest<{ mimeType: string }>(`/api/attachments/${reservedId}/confirm`, { method: 'POST' })
    const latest = useUploadOutbox.getState().uploads[localId]
    if (!latest || latest.attempt !== attempt) {
      deleteRemoteAttachment(reservedId)
      return
    }
    const userId = useAuth.getState().user?.id
    if (userId && !latest.temporary) {
      await cacheAttachmentBlob(userId, {
        id: reservedId,
        originalName: file.name,
        mimeType: confirmed.mimeType,
        sizeBytes: file.size,
      }, file, useSettings.getState().localAttachmentCacheMb).catch(() => false)
    }
    useUploadOutbox.setState((state) => ({
      uploads: {
        ...state.uploads,
        [localId]: {
          ...state.uploads[localId]!,
          id: reservedId,
          mimeType: confirmed.mimeType,
          status: 'ready',
          error: undefined,
        },
      },
    }))
  } catch (error) {
    const current = useUploadOutbox.getState().uploads[localId]
    if (!current || current.attempt !== attempt) return
    useUploadOutbox.setState((state) => ({
      uploads: {
        ...state.uploads,
        [localId]: {
          ...state.uploads[localId]!,
          id: reservedId ?? state.uploads[localId]!.id,
          status: 'error',
          error: attachmentUploadErrorMessage(error),
        },
      },
    }))
  }
  for (const chatId of referencedChatIds(localId)) scheduleChat(chatId)
}

function recoverSubmission(submission: PendingSubmission, message?: string): void {
  useChat.getState().removePendingMessage(submission.chatId, submission.responseId)
  useUploadOutbox.setState((state) => ({
    submissions: state.submissions.map((item) => item.id === submission.id
      ? { ...item, status: 'recovery', recoveryError: message }
      : item),
  }))
}

function restrictionMessage(submission: PendingSubmission, records: UploadRecord[]): string | null {
  const hasNonImage = records.some((record) => !isSupportedImageMime(record.mimeType))
  const model = getCatalogModel(submission.modelId)
  const restriction = nonImageAttachmentRestriction({
    hasNonImage,
    agentModeEnabled: submission.agentMode,
    agentAvailable: useCatalog.getState().agentAvailable,
    agentCapable: Boolean(model.agentEnabled),
  })
  if (restriction === 'enable_agent') return ui("Enable Agent mode before sending this non-image attachment.")
  if (restriction === 'model_not_capable') return ui("Switch to an Agent-capable model or remove the non-image attachment.")
  if (restriction === 'agent_unavailable') return ui("Agent mode is unavailable. Remove the non-image attachment to continue.")
  return null
}

const processingChats = new Set<string>()

async function processChat(chatId: string): Promise<void> {
  if (processingChats.has(chatId)) return
  processingChats.add(chatId)
  try {
    while (true) {
      const state = useUploadOutbox.getState()
      const submission = state.submissions.find((item) => item.chatId === chatId)
      if (!submission || submission.status === 'recovery' || submission.status === 'dispatching') return
      const records = submission.attachmentIds.map((id) => state.uploads[id]).filter(Boolean)
      if (records.length !== submission.attachmentIds.length) {
        recoverSubmission(submission, 'One or more attachments are no longer available.')
        return
      }
      const restriction = restrictionMessage(submission, records)
      const chat = useChat.getState().chats.find((item) => item.id === chatId)
      if (!chat) return
      if (submission.placement === 'queue' && chat.provisional && chat.messages.length === 0) {
        useChat.getState().removePendingMessage(chatId, submission.responseId)
        const promoted = { ...submission, placement: 'bubble' as const }
        useUploadOutbox.setState((current) => ({
          submissions: current.submissions.map((item) => item.id === submission.id ? promoted : item),
        }))
        renderSubmissionSurface(promoted, records)
        continue
      }
      const action = uploadOutboxHeadAction({
        attachmentStatuses: records.map((record) => record.status),
        restricted: Boolean(restriction),
        placement: submission.placement,
        provisionalChat: Boolean(chat.provisional),
      })
      if (action === 'wait') return
      if (action === 'recover') {
        recoverSubmission(submission, restriction ?? undefined)
        return
      }
      const attachments = records.map(readyAttachment).filter((item): item is Attachment => Boolean(item))
      useUploadOutbox.setState((current) => ({
        submissions: current.submissions.map((item) => item.id === submission.id
          ? { ...item, status: 'dispatching' }
          : item),
      }))

      if (action === 'send') {
        useChat.getState().sendMessage(
          chat.provisional ? null : chatId,
          submission.content,
          submission.modelId,
          attachments,
          submission.temporary,
          submission.autoExpire,
          {
            targetChatId: chatId,
            responseId: submission.responseId,
            presetSelections: submission.presetSelections,
            agentMode: submission.agentMode,
          },
        )
        useUploadOutbox.getState().consumeUploads(submission.attachmentIds)
        try {
          await waitForResponseDispatch(submission.responseId)
          const completed = useUploadOutbox.getState().submissions.find((item) => item.id === submission.id) ?? submission
          useUploadOutbox.setState((current) => ({
            submissions: current.submissions.filter((item) => item.id !== submission.id),
          }))
          clearSubmissionDraft(completed)
        } catch {
          useUploadOutbox.setState((current) => ({
            submissions: current.submissions.filter((item) => item.id !== submission.id),
          }))
          // A failed dispatch retains the durable draft.
        }
        continue
      }

      try {
        await useChat.getState().enqueueMessage(chatId, {
          input: submission.content,
          modelId: submission.modelId,
          presetSelections: submission.presetSelections,
          attachmentIds: attachments.map((attachment) => attachment.id),
          agentMode: submission.agentMode,
        }, attachments, submission.responseId)
        const completed = useUploadOutbox.getState().submissions.find((item) => item.id === submission.id) ?? submission
        useUploadOutbox.setState((current) => ({
          submissions: current.submissions.filter((item) => item.id !== submission.id),
        }))
        useUploadOutbox.getState().consumeUploads(submission.attachmentIds)
        clearSubmissionDraft(completed)
      } catch (error) {
        recoverSubmission(submission, error instanceof Error ? error.message : 'Unable to queue message')
        return
      }
    }
  } finally {
    processingChats.delete(chatId)
  }
}

/** Exposed for deterministic store tests; production callers use the scheduled actions above. */
export function processUploadOutboxChat(chatId: string): Promise<void> {
  return processChat(chatId)
}

function releaseRecords(localIds: string[], consumed: boolean): void {
  const state = useUploadOutbox.getState()
  const referenced = new Set([
    ...state.submissions.flatMap((submission) => submission.attachmentIds),
    ...Object.values(state.preservedDrafts).flatMap((draft) => draft.attachmentIds),
  ])
  const releasable = localIds.filter((id) => consumed || !referenced.has(id))
  const records = releasable.map((id) => state.uploads[id]).filter(Boolean)
  useUploadOutbox.setState((current) => ({
    uploads: Object.fromEntries(Object.entries(current.uploads).filter(([id]) => !releasable.includes(id))),
  }))
  for (const record of records) {
    if (record.previewUrl) URL.revokeObjectURL(record.previewUrl)
    if (!consumed && record.managed && record.id) deleteRemoteAttachment(record.id)
  }
}

export const useUploadOutbox = create<UploadOutboxState>()((set, get) => ({
  uploads: {},
  submissions: [],
  preservedDrafts: {},

  addFiles: (files, options) => {
    const records = files.map((file): UploadRecord => ({
      localId: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      previewUrl: isSupportedImageFile(file) ? URL.createObjectURL(file) : null,
      status: 'uploading',
      file,
      chatId: options.chatId,
      temporary: options.temporary,
      managed: true,
      attempt: 1,
    }))
    set((state) => ({
      uploads: { ...state.uploads, ...Object.fromEntries(records.map((record) => [record.localId, record])) },
    }))
    for (const record of records) void uploadRecord(record.localId, record.attempt)
    return records.map((record) => record.localId)
  },

  addExistingAttachments: (attachments, options) => {
    const records = attachments.map((attachment): UploadRecord => ({
      localId: crypto.randomUUID(),
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType,
      previewUrl: null,
      status: 'ready',
      chatId: options.chatId,
      temporary: options.temporary,
      managed: false,
      attempt: 0,
    }))
    set((state) => ({
      uploads: { ...state.uploads, ...Object.fromEntries(records.map((record) => [record.localId, record])) },
    }))
    return records.map((record) => record.localId)
  },

  stageSubmission: (draft) => {
    const records = draft.attachmentIds.map((id) => get().uploads[id]).filter(Boolean)
    const responseId = crypto.randomUUID()
    const createdAt = Date.now()
    const currentChat = draft.chatId
      ? useChat.getState().chats.find((chat) => chat.id === draft.chatId)
      : undefined
    const placement = optimisticSubmissionPlacement({
      hasChat: Boolean(currentChat),
      provisionalChat: Boolean(currentChat?.provisional),
      activeResponse: Boolean(currentChat?.messages.some((message) => message.role === 'assistant' && !message.done)),
      queuedMessageCount: currentChat?.queuedMessages?.length ?? 0,
      pendingSubmissionCount: draft.chatId
        ? get().submissions.filter((submission) => submission.chatId === draft.chatId).length
        : 0,
      lastMessageRole: currentChat?.messages.at(-1)?.role,
    })
    const staged = placement === 'bubble'
      ? useChat.getState().stagePendingMessage({
          chatId: draft.chatId,
          responseId,
          content: draft.content,
          modelId: draft.modelId,
          attachments: records.map(pendingAttachment),
          temporary: draft.temporary,
          autoExpire: draft.autoExpire,
          createdAt,
        })
      : { chatId: draft.chatId!, responseId }
    const submission: PendingSubmission = {
      id: responseId,
      chatId: staged.chatId,
      responseId,
      content: draft.content,
      modelId: draft.modelId,
      presetSelections: draft.presetSelections,
      agentMode: draft.agentMode,
      temporary: draft.temporary,
      autoExpire: draft.autoExpire,
      attachmentIds: draft.attachmentIds,
      createdAt,
      placement,
      status: 'waiting',
      draftScope: draft.chatId ?? 'new',
      clearDraftOnSuccess: true,
    }
    if (placement === 'queue') renderSubmissionSurface(submission, records)
    set((state) => ({ submissions: [...state.submissions, submission] }))
    scheduleChat(staged.chatId)
    return { chatId: staged.chatId, submissionId: submission.id }
  },

  retainDraftAfterSubmission: (scope) => set((state) => ({
    submissions: state.submissions.map((submission) => (
      submission.draftScope === scope && submission.clearDraftOnSuccess
        ? { ...submission, clearDraftOnSuccess: false }
        : submission
    )),
  })),

  resumeSubmission: (submissionId, draft) => {
    const submission = get().submissions.find((item) => item.id === submissionId)
    if (!submission) return
    const records = draft.attachmentIds.map((id) => get().uploads[id]).filter(Boolean)
    const resumed = {
      ...submission,
      content: draft.content,
      modelId: draft.modelId,
      presetSelections: draft.presetSelections,
      agentMode: draft.agentMode,
      attachmentIds: draft.attachmentIds,
      status: 'waiting' as const,
      recoveryError: undefined,
    }
    renderSubmissionSurface(resumed, records)
    set((state) => ({
      submissions: state.submissions.map((item) => item.id === submissionId ? resumed : item),
    }))
    scheduleChat(submission.chatId)
  },

  returnSubmissionToComposer: (submissionId) => {
    const submission = get().submissions.find((item) => item.id === submissionId)
    if (!submission || get().submissions.some((item) => item.chatId === submission.chatId && item.status === 'recovery')) return
    recoverSubmission(submission)
  },

  discardSubmission: (submissionId) => {
    const submission = get().submissions.find((item) => item.id === submissionId)
    if (!submission) return
    useChat.getState().removePendingMessage(submission.chatId, submission.responseId)
    set((state) => ({ submissions: state.submissions.filter((item) => item.id !== submissionId) }))
    releaseRecords(submission.attachmentIds, false)
    scheduleChat(submission.chatId)
  },

  preserveComposerDraft: (chatId, draft) => set((state) => ({
    preservedDrafts: state.preservedDrafts[chatId]
      ? state.preservedDrafts
      : { ...state.preservedDrafts, [chatId]: draft },
  })),

  takePreservedComposerDraft: (chatId) => {
    const draft = get().preservedDrafts[chatId] ?? null
    if (!draft) return null
    set((state) => ({
      preservedDrafts: Object.fromEntries(Object.entries(state.preservedDrafts).filter(([id]) => id !== chatId)),
    }))
    return draft
  },

  retryUpload: (localId) => {
    const record = get().uploads[localId]
    if (!record?.file) return
    if (record.managed && record.id) deleteRemoteAttachment(record.id)
    const attempt = record.attempt + 1
    set((state) => ({
      uploads: {
        ...state.uploads,
        [localId]: { ...state.uploads[localId]!, id: undefined, status: 'uploading', error: undefined, attempt },
      },
    }))
    void uploadRecord(localId, attempt)
  },

  removeUpload: (localId) => {
    const chats = referencedChatIds(localId)
    set((state) => ({
      submissions: state.submissions.map((submission) => ({
        ...submission,
        attachmentIds: submission.attachmentIds.filter((id) => id !== localId),
      })),
    }))
    releaseRecords([localId], false)
    for (const chatId of chats) scheduleChat(chatId)
  },

  releaseDraftUploads: (localIds) => releaseRecords(localIds, false),
  consumeUploads: (localIds) => releaseRecords(localIds, true),
}))
