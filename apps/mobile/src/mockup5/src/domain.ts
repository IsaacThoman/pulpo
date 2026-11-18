import type { MobileQueuedMessage } from '../../types';
export type ThemePreference = 'system' | 'light' | 'dark';
export type TextSizePreference = 'default' | 'large' | 'extra-large';
export type TrashRetention = 'instant' | '24h' | '7d' | '30d' | '90d' | 'indefinite';
export type AutomaticChatExpiration = 'disabled' | '24h' | '7d';
export type ChatSortMode = 'default' | 'recent';
export type SessionStatus = 'signed-out' | 'signed-in' | 'pending';

export interface InstanceProfile {
  url: string;
  name: string;
  version: string;
  signupOpen: boolean;
  connectedAt: number;
}

export interface SessionState {
  status: SessionStatus;
  user: {
    id: string;
    name: string;
    email: string;
    role: 'member' | 'pending';
    initials: string;
  } | null;
}

export interface GenerationPresetChoice {
  id: string;
  label: string;
  icon: string;
}

export interface GenerationPreset {
  id: string;
  name: string;
  icon: string;
  choices: GenerationPresetChoice[];
  selectedId: string;
}

export interface PrototypeModel {
  id: string;
  /** Hidden model IDs reached through this visible model's preset redirects. */
  redirectTargetModelIds?: string[];
  name: string;
  providerGroupId: string;
  provider: string;
  lab: string;
  description: string;
  /** Admin-configured markdown notice shown above the composer. */
  warningMessage?: string;
  warningDismissDays?: number;
  contextWindow: string;
  pricing: string;
  tags: string[];
  enabled: boolean;
  agentEnabled: boolean;
  favorite: boolean;
  tint: string;
  modelLogo?: string;
  labLogo?: string;
  modelCustomIcon?: import('../../types').MobileCatalogIcon | null;
  labCustomIcon?: import('../../types').MobileCatalogIcon | null;
  presets: GenerationPreset[];
  /** Data retention tag shown beside the provider. */
  dataRetention?: import('@pulpo/contracts').DataRetentionTag | null;
}

export type AttachmentStatus = 'uploading' | 'ready' | 'failed' | 'cached';

export interface PrototypeAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uri?: string;
  kind: 'image' | 'file';
  status: AttachmentStatus;
  progress?: number;
  error?: string;
}

export type ActivityStep =
  | { id: string; kind: 'reasoning'; title: string; detail: string; durationMs: number; status: 'complete' | 'active' }
  | { id: string; kind: 'tool'; title: string; detail: string; output?: string; durationMs: number; status: 'complete' | 'active' | 'failed' }
  | { id: string; kind: 'workspace'; title: string; detail: string; durationMs: number; status: 'complete' | 'active' | 'failed' }
  | { id: string; kind: 'compaction'; title: string; detail: string; durationMs: number; status: 'complete' | 'active' | 'failed' }
  | { id: string; kind: 'recall'; title: string; detail: string; durationMs: number; status: 'complete' | 'active' | 'failed' };

export interface ResponseBranch {
  id: string;
  text: string;
  modelId: string;
  createdAt: number;
}

export interface PrototypeMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  requestReceivedAt?: string | null;
  firstReplyTextAt?: string | null;
  initialResponseDurationMs?: number;
  latencyMs?: number;
  modelId?: string;
  attachments?: PrototypeAttachment[];
  activity?: ActivityStep[];
  branches?: ResponseBranch[];
  activeBranch?: number;
  status?: 'complete' | 'streaming' | 'queued' | 'failed' | 'stopped';
  error?: string;
  meta?: string;
  /** Headline response cost in USD micros, once usage has settled. */
  costMicros?: number;
  feedback?: 'good' | 'bad' | null;
  outputItems?: unknown[];
  agentMode?: boolean;
  presetSelections?: Record<string, string>;
}

export interface PrototypeChat {
  id: string;
  title: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  folderId: string | null;
  /** Filed at the top of My files: outside the sidebar, which lists the Chats folder. */
  inFilesRoot?: boolean;
  /** Manual position within the pinned list, its folder, or the unfiled list. */
  sortOrder: number;
  temporary: boolean;
  expiresAt?: number | null;
  expired?: boolean;
  /** False while a server chat only has list metadata and its transcript is loading. */
  detailLoaded?: boolean;
  queuedMessages?: MobileQueuedMessage[];
  messages: PrototypeMessage[];
  deletedAt: number | null;
  purgeAt: number | null;
  /** Files items the chat's agent works with: the ones its messages mentioned (see ChatFilesAccessSheet). */
  fileScopeIds?: string[];
  /** Per-item modes older clients set; the chat's fileChangeMode replaces them once changed. */
  fileScopeAccess?: Partial<Record<string, import('@pulpo/contracts').FileAccessMode>>;
  /** What the agent may change in Files in this chat. */
  fileChangeMode?: import('@pulpo/contracts').FileAccessMode;
  /** The user let the agent look through all of their Files in this chat. */
  filesBrowseAllowed?: boolean;
}

export interface PrototypeFolder {
  id: string;
  name: string;
  expanded: boolean;
}

export interface AppPreferences {
  imageGeneration: import('@pulpo/contracts').ImageGenerationPreferences;
  speech: import('@pulpo/contracts').SpeechPreferences;
  theme: ThemePreference;
  textSize: TextSizePreference;
  sendWithEnter: boolean;
  streamResponses: boolean;
  showPromptSuggestions: boolean;
  showModelWarnings: boolean;
  modelWarningDismissals: import('@pulpo/contracts').ModelWarningDismissals;
  showReasoning: boolean;
  showResponseCost: boolean;
  agentCostLimitEnabled: boolean;
  agentCostLimitMicros: number;
  agentFilesAskBeforeBrowsing: boolean;
  agentFileChangeMode: import('@pulpo/contracts').FileAccessMode;
  memoryEnabled: boolean;
  customInstructions: string;
  instructionPresetSelections: Record<string, boolean>;
  haptics: boolean;
  localChatLimit: number;
  attachmentCacheMb: number;
  trashRetention: TrashRetention;
  automaticChatExpiration: AutomaticChatExpiration;
  newChatAutoExpire: boolean;
  chatSortMode: ChatSortMode;
}

export interface PersistedPrototypeState {
  instance: InstanceProfile;
  session: SessionState;
  models: PrototypeModel[];
  defaultModelId: string;
  chats: PrototypeChat[];
  folders: PrototypeFolder[];
  preferences: AppPreferences;
}
