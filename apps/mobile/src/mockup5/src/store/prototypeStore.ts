import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type {
  AppPreferences, DemoScenarios, PersistedPrototypeState,
  PrototypeChat, PrototypeFolder, PrototypeMessage, SessionState,
} from '../domain';
import { normalizeInstanceUrl } from '../domain';
import { createSeedState, SEED_VERSION } from '../seed';
import { productionActions, runProductionAction } from '../production/productionActions';

type PrototypeActions = {
  hydrated: boolean;
  setHydrated: (hydrated: boolean) => void;
  signIn: (email: string) => void;
  signUp: (name: string, email: string) => void;
  approvePendingDemo: () => void;
  signOut: () => void;
  connectInstance: (rawUrl: string) => string;
  updateProfile: (patch: Partial<NonNullable<SessionState['user']>>) => void;
  setPreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void;
  setDemoScenario: <K extends keyof DemoScenarios>(key: K, value: DemoScenarios[K]) => void;
  addMemory: (content: string) => void;
  forgetMemory: (id: string) => void;
  addFolder: (name: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  toggleFolder: (id: string) => void;
  upsertChat: (chat: PrototypeChat) => void;
  discardChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  moveChat: (id: string, folderId: string | null) => void;
  trashChat: (id: string) => void;
  restoreChat: (id: string) => void;
  permanentlyDeleteChat: (id: string) => void;
  emptyTrash: () => void;
  appendMessage: (chatId: string, message: PrototypeMessage) => void;
  updateMessage: (chatId: string, messageId: string, patch: Partial<PrototypeMessage>) => void;
  deleteMessageCascade: (chatId: string, messageId: string) => void;
  addRecentSearch: (query: string) => void;
  setDefaultModel: (id: string) => void;
  toggleFavoriteModel: (id: string) => void;
  resetDemo: () => void;
};

export type PrototypeStore = PersistedPrototypeState & PrototypeActions;

const retentionMs: Record<AppPreferences['trashRetention'], number | null> = {
  instant: 0, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000,
  '90d': 7_776_000_000, indefinite: null,
};

const initialsFor = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const productionPreferenceKeys = new Set(['theme', 'textSize', 'streamResponses', 'showReasoning', 'haptics', 'sendWithEnter', 'attachmentCacheMb', 'localChatLimit']);

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPersistence: { name: string; value: StorageValue<PersistedPrototypeState> } | undefined;
const coalescedStorage: PersistStorage<PersistedPrototypeState> = {
  getItem: async (name) => {
    const value = await AsyncStorage.getItem(name);
    return value ? JSON.parse(value) as StorageValue<PersistedPrototypeState> : null;
  },
  setItem: (name, value) => {
    pendingPersistence = { name, value };
    if (persistenceTimer) clearTimeout(persistenceTimer);
    persistenceTimer = setTimeout(() => {
      const pending = pendingPersistence;
      pendingPersistence = undefined;
      persistenceTimer = undefined;
      if (pending) void AsyncStorage.setItem(pending.name, JSON.stringify(pending.value));
    }, 500);
    return Promise.resolve();
  },
  removeItem: async (name: string) => {
    if (persistenceTimer) clearTimeout(persistenceTimer);
    persistenceTimer = undefined;
    pendingPersistence = undefined;
    await AsyncStorage.removeItem(name);
  },
};

export function migratePrototypeState(value: unknown): PersistedPrototypeState {
  const seed = createSeedState();
  if (!value || typeof value !== 'object') return seed;
  const previous = value as Partial<PersistedPrototypeState>;
  if (previous.seedVersion !== SEED_VERSION) {
    return {
      ...seed,
      instance: previous.instance ?? seed.instance,
      session: previous.session ?? seed.session,
      preferences: { ...seed.preferences, ...(previous.preferences ?? {}) },
    };
  }
  const cleanDemo = previous.demo ? { ...previous.demo } : {};
  delete (cleanDemo as Record<string, unknown>).microphone;
  return { ...seed, ...previous, preferences: { ...seed.preferences, ...(previous.preferences ?? {}) }, demo: { ...seed.demo, ...cleanDemo } };
}

export const usePrototypeStore = create<PrototypeStore>()(persist((set, get) => ({
  ...createSeedState(), hydrated: false,
  setHydrated: (hydrated) => set({ hydrated }),
  signIn: (email) => set({ session: { status: 'signed-in', user: { id: 'u-demo', name: email.toLowerCase().startsWith('isaac') ? 'Isaac Thoman' : 'Pulpo Member', email, role: 'member', initials: email.toLowerCase().startsWith('isaac') ? 'IT' : 'PM' } } }),
  signUp: (name, email) => set({ session: { status: 'pending', user: { id: id('user'), name, email, role: 'pending', initials: initialsFor(name) } } }),
  approvePendingDemo: () => set((state) => state.session.user ? { session: { status: 'signed-in', user: { ...state.session.user, role: 'member' } } } : {}),
  signOut: () => set({ session: { status: 'signed-out', user: null } }),
  connectInstance: (rawUrl) => {
    const url = normalizeInstanceUrl(rawUrl);
    if (/offline|invalid|fail/i.test(url)) throw new Error('Couldn’t reach a Pulpo server at this address.');
    const hostname = new URL(url).hostname;
    set({ instance: { url, name: hostname === 'pulpo.baby' ? 'Pulpo' : hostname.split('.')[0]?.replace(/(^.|-.)/g, (match) => match.replace('-', ' ').toUpperCase()) || 'Pulpo', version: '0.1.0', signupOpen: !hostname.includes('closed'), connectedAt: Date.now() } });
    return url;
  },
  updateProfile: (patch) => set((state) => state.session.user ? { session: { ...state.session, user: { ...state.session.user, ...patch, initials: patch.name ? initialsFor(patch.name) : state.session.user.initials } } } : {}),
  setPreference: (key, value) => {
    set((state) => ({ preferences: { ...state.preferences, [key]: value } }));
    if (productionPreferenceKeys.has(key)) runProductionAction(productionActions.setPreference(key as never, value as never));
  },
  setDemoScenario: (key, value) => set((state) => ({ demo: { ...state.demo, [key]: value } })),
  addMemory: (content) => set((state) => ({ memories: [...state.memories, { id: id('memory'), content: content.trim() }] })),
  forgetMemory: (memoryId) => set((state) => ({ memories: state.memories.filter((memory) => memory.id !== memoryId) })),
  addFolder: (name) => { const folderId = id('folder'); set((state) => ({ folders: [...state.folders, { id: folderId, name: name.trim(), expanded: true }] })); runProductionAction(productionActions.createFolder(name.trim(), folderId)); return folderId; },
  renameFolder: (folderId, name) => { set((state) => ({ folders: state.folders.map((folder) => folder.id === folderId ? { ...folder, name: name.trim() } : folder) })); runProductionAction(productionActions.renameFolder(folderId, name.trim())); },
  deleteFolder: (folderId) => { set((state) => ({ folders: state.folders.filter((folder) => folder.id !== folderId), chats: state.chats.map((chat) => chat.folderId === folderId ? { ...chat, folderId: null } : chat) })); runProductionAction(productionActions.deleteFolder(folderId)); },
  toggleFolder: (folderId) => set((state) => ({ folders: state.folders.map((folder) => folder.id === folderId ? { ...folder, expanded: !folder.expanded } : folder) })),
  upsertChat: (chat) => set((state) => ({ chats: state.chats.some((item) => item.id === chat.id) ? state.chats.map((item) => item.id === chat.id ? chat : item) : [chat, ...state.chats] })),
  discardChat: (chatId) => set((state) => ({ chats: state.chats.filter((chat) => chat.id !== chatId) })),
  renameChat: (chatId, title) => { set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, title: title.trim(), updatedAt: Date.now() } : chat) })); runProductionAction(productionActions.renameChat(chatId, title.trim())); },
  togglePin: (chatId) => { const next = !get().chats.find((chat) => chat.id === chatId)?.pinned; set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, pinned: next } : chat) })); runProductionAction(productionActions.togglePin(chatId, next)); },
  moveChat: (chatId, folderId) => { set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, folderId } : chat) })); runProductionAction(productionActions.moveChat(chatId, folderId)); },
  trashChat: (chatId) => { set((state) => {
    const duration = retentionMs[state.preferences.trashRetention];
    if (duration === 0) return { chats: state.chats.filter((chat) => chat.id !== chatId) };
    const deletedAt = Date.now();
    return { chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, deletedAt, purgeAt: duration === null ? null : deletedAt + duration, pinned: false } : chat) };
  }); runProductionAction(productionActions.trashChat(chatId)); },
  restoreChat: (chatId) => { set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, deletedAt: null, purgeAt: null, updatedAt: Date.now() } : chat) })); runProductionAction(productionActions.restoreChat(chatId)); },
  permanentlyDeleteChat: (chatId) => { set((state) => ({ chats: state.chats.filter((chat) => chat.id !== chatId) })); runProductionAction(productionActions.permanentlyDeleteChat(chatId)); },
  emptyTrash: () => {
    set((state) => ({ chats: state.chats.filter((chat) => chat.deletedAt === null) }));
    runProductionAction(productionActions.emptyTrash());
  },
  appendMessage: (chatId, message) => set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? {
    ...chat,
    messages: chat.messages.some((candidate) => candidate.id === message.id)
      ? chat.messages.map((candidate) => candidate.id === message.id ? { ...candidate, ...message } : candidate)
      : [...chat.messages, message],
    updatedAt: Date.now(),
  } : chat) })),
  updateMessage: (chatId, messageId, patch) => set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, messages: chat.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message), updatedAt: Date.now() } : chat) })),
  deleteMessageCascade: (chatId, messageId) => set((state) => ({ chats: state.chats.map((chat) => {
    if (chat.id !== chatId) return chat;
    const index = chat.messages.findIndex((message) => message.id === messageId);
    return index < 0 ? chat : { ...chat, messages: chat.messages.slice(0, index), updatedAt: Date.now() };
  }) })),
  addRecentSearch: (query) => set((state) => ({ recentSearches: [query.trim(), ...state.recentSearches.filter((item) => item.toLowerCase() !== query.trim().toLowerCase())].slice(0, 6) })),
  setDefaultModel: (defaultModelId) => { set({ defaultModelId }); runProductionAction(productionActions.setPreference('defaultModelId', defaultModelId)); },
  toggleFavoriteModel: (modelId) => {
    const favoriteModelIds = get().models.filter((model) => model.favorite !== (model.id === modelId)).map((model) => model.id);
    set((state) => ({ models: state.models.map((model) => model.id === modelId ? { ...model, favorite: !model.favorite } : model) }));
    runProductionAction(productionActions.setPreference('favoriteModelIds', favoriteModelIds));
  },
  resetDemo: () => set({ ...createSeedState(), hydrated: true }),
}), {
  name: 'pulpo-mockup-5-prototype-v3',
  version: SEED_VERSION,
  storage: coalescedStorage,
  migrate: (persisted) => migratePrototypeState(persisted),
  partialize: (state) => ({
    seedVersion: state.seedVersion, instance: state.instance, session: state.session, models: state.models,
    defaultModelId: state.defaultModelId, chats: state.chats, folders: state.folders,
    usage: state.usage, memories: state.memories, preferences: state.preferences, demo: state.demo, recentSearches: state.recentSearches,
  }),
  onRehydrateStorage: () => (state) => state?.setHydrated(true),
}));

export const selectFolders = (state: PrototypeStore): PrototypeFolder[] => state.folders;
