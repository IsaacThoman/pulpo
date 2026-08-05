export type ThemePreference = 'system' | 'light' | 'dark';
export type TextSizePreference = 'default' | 'large' | 'extra-large';
export type ResponseScenario = 'success' | 'tool-heavy' | 'capacity' | 'failure';
export type TrashRetention = 'instant' | '24h' | '7d' | '30d' | '90d' | 'indefinite';
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
  name: string;
  providerGroupId: string;
  provider: string;
  lab: string;
  description: string;
  contextWindow: string;
  pricing: string;
  tags: string[];
  enabled: boolean;
  agentEnabled: boolean;
  favorite: boolean;
  tint: string;
  asset: 'claude' | 'openai' | 'gemini' | 'deepseek';
  modelLogo?: string;
  labLogo?: string;
  presets: GenerationPreset[];
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
  | { id: string; kind: 'compaction'; title: string; detail: string; durationMs: number; status: 'complete' | 'active' | 'failed' };

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
  modelId?: string;
  attachments?: PrototypeAttachment[];
  activity?: ActivityStep[];
  branches?: ResponseBranch[];
  activeBranch?: number;
  status?: 'complete' | 'streaming' | 'queued' | 'failed' | 'stopped';
  error?: string;
  meta?: string;
  feedback?: 'good' | 'bad' | null;
  outputItems?: unknown[];
  agentMode?: boolean;
}

export interface PrototypeChat {
  id: string;
  title: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  folderId: string | null;
  temporary: boolean;
  /** False while a server chat only has list metadata and its transcript is loading. */
  detailLoaded?: boolean;
  messages: PrototypeMessage[];
  deletedAt: number | null;
  purgeAt: number | null;
}

export interface PrototypeFolder {
  id: string;
  name: string;
  expanded: boolean;
}

export interface AppPreferences {
  theme: ThemePreference;
  textSize: TextSizePreference;
  sendWithEnter: boolean;
  streamResponses: boolean;
  showReasoning: boolean;
  haptics: boolean;
  localChatLimit: number;
  attachmentCacheMb: number;
  trashRetention: TrashRetention;
}

export interface DemoScenarios {
  response: ResponseScenario;
}

export interface PersistedPrototypeState {
  instance: InstanceProfile;
  session: SessionState;
  models: PrototypeModel[];
  defaultModelId: string;
  chats: PrototypeChat[];
  folders: PrototypeFolder[];
  preferences: AppPreferences;
  demo: DemoScenarios;
}

export function normalizeInstanceUrl(input: string): string {
  const candidate = input.trim();
  if (!candidate) throw new Error('Enter an instance URL.');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate) && !/^https?:\/\//i.test(candidate)) {
    throw new Error('Use an HTTP or HTTPS address.');
  }
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error('Enter a valid web address.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an HTTP or HTTPS address.');
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error('Enter a valid Pulpo instance address.');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.origin;
}
