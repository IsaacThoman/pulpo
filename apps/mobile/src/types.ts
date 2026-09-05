import type { ChatPreset, QueuedMessage, EmbeddedResponseSnapshot, ResponseSnapshot, User } from '@pulpo/contracts'

export type { User }

export interface MobileCatalogIcon {
  id: string
  mode: 'original' | 'monochrome'
  lightUrl: string
  darkUrl: string
}

export interface MobileModel {
  id: string
  name: string
  description: string
  executionMode: 'stream' | 'background'
  maxOutputTokens: number
  agentEnabled: boolean
  tags: string[]
  logo: string | null
  customIcon?: MobileCatalogIcon | null
  iconLight: string | null
  iconDark: string | null
  provider: { id: string; name: string }
  lab: { id: string; name: string; logo: string; customIcon?: MobileCatalogIcon | null } | null
  presets: ChatPreset[]
}

export type MobileQueuedMessage = QueuedMessage & { pendingSubmissionId?: string; localFailure?: boolean }

export interface ServerChat {
  id: string
  title: string
  modelId: string
  pinned: boolean
  folderId: string | null
  sortOrder: number
  temporary: boolean
  expiresAt?: string | null
  activeResponseId: string | null
  activeBranchLeafId?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  purgeAt?: string | null
  attachments?: ServerAttachment[]
  queuedMessages?: MobileQueuedMessage[]
  responses?: ServerResponse[]
}

export interface ServerDeletedChat {
  id: string
  title: string
  modelId: string
  deletedAt: string
  purgeAt: string | null
}

export interface ServerFolder {
  id: string
  name: string
  pinned: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ServerAttachment {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

export interface ServerResponse {
  id: string
  parentResponseId: string | null
  previousResponseId: string | null
  userMessageId: string | null
  modelId: string
  displayModelId?: string
  status: ResponseSnapshot['status']
  input: unknown[]
  output: unknown[]
  presetSelections: Record<string, string>
  agentMode: boolean
  usage: { inputTokens: number; outputTokens: number } | null
  error: { message?: string } | null
  createdAt: string
  completedAt: string | null
  snapshot: ResponseSnapshot | EmbeddedResponseSnapshot
  branches: {
    user: { ids: string[]; index: number }
    assistant: { ids: string[]; index: number }
  }
  detailAvailable?: boolean
}

export interface BranchActivationResult {
  activeBranchLeafId: string
  responses?: ServerResponse[]
}

export interface AttachmentDraft {
  localId: string
  serverId?: string
  name: string
  uri: string
  mimeType: string
  sizeBytes: number
  state: 'local' | 'uploading' | 'ready' | 'failed'
  error?: string
}
