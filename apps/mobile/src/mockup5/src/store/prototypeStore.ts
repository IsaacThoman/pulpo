import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type {
  AppPreferences, PersistedPrototypeState,
  PrototypeChat, PrototypeFolder, PrototypeMessage, SessionState,
} from '../domain';
import { createSeedState } from '../seed';
import { productionActions, runProductionAction } from '../production/productionActions';

type PrototypeActions = {
  productionNamespace: string | null;
  agentAvailable: boolean;
  updateProfile: (patch: Partial<NonNullable<SessionState['user']>>) => void;
  setPreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void;
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
  trashAllChats: () => void;
  restoreChat: (id: string) => void;
  permanentlyDeleteChat: (id: string) => void;
  emptyTrash: () => void;
  appendMessage: (chatId: string, message: PrototypeMessage) => void;
  updateMessage: (chatId: string, messageId: string, patch: Partial<PrototypeMessage>) => void;
  deleteMessageCascade: (chatId: string, messageId: string) => void;
  setDefaultModel: (id: string) => void;
  toggleFavoriteModel: (id: string) => void;
};

export type PrototypeStore = PersistedPrototypeState & PrototypeActions;

export const LEGACY_PROTOTYPE_STORAGE_KEYS = [
  'pulpo-mockup-5-prototype-v1',
  'pulpo-mockup-5-prototype-v2',
  'pulpo-mockup-5-prototype-v3',
] as const;

/**
 * The prototype used to persist a second, non-namespaced copy of production
 * data. SQLite is now the only persisted source for chats and account data.
 */
export async function purgeLegacyPrototypeSnapshots(): Promise<void> {
  await AsyncStorage.multiRemove([...LEGACY_PROTOTYPE_STORAGE_KEYS]);
}

const retentionMs: Record<AppPreferences['trashRetention'], number | null> = {
  instant: 0, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000,
  '90d': 7_776_000_000, indefinite: null,
};

const initialsFor = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const productionPreferenceKeys = new Set(['theme', 'textSize', 'streamResponses', 'showReasoning', 'haptics', 'sendWithEnter', 'attachmentCacheMb', 'localChatLimit', 'trashRetention']);

export const usePrototypeStore = create<PrototypeStore>()((set, get) => ({
  ...createSeedState(), productionNamespace: null, agentAvailable: false,
  updateProfile: (patch) => set((state) => state.session.user ? { session: { ...state.session, user: { ...state.session.user, ...patch, initials: patch.name ? initialsFor(patch.name) : state.session.user.initials } } } : {}),
  setPreference: (key, value) => {
    set((state) => ({ preferences: { ...state.preferences, [key]: value } }));
    if (productionPreferenceKeys.has(key)) runProductionAction(productionActions.setPreference(key as never, value as never));
  },
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
  trashAllChats: () => {
    set((state) => {
      const duration = retentionMs[state.preferences.trashRetention];
      if (duration === 0) return { chats: [] };
      const deletedAt = Date.now();
      return { chats: state.chats.map((chat) => chat.deletedAt === null ? {
        ...chat,
        deletedAt,
        purgeAt: duration === null ? null : deletedAt + duration,
        pinned: false,
      } : chat) };
    });
    runProductionAction(productionActions.trashAllChats());
  },
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
  setDefaultModel: (defaultModelId) => { set({ defaultModelId }); runProductionAction(productionActions.setPreference('defaultModelId', defaultModelId)); },
  toggleFavoriteModel: (modelId) => {
    const favorite = !get().models.find((model) => model.id === modelId)?.favorite;
    set((state) => ({ models: state.models.map((model) => model.id === modelId ? { ...model, favorite: !model.favorite } : model) }));
    runProductionAction(productionActions.toggleFavoriteModel(modelId, favorite));
  },
}));

export const selectFolders = (state: PrototypeStore): PrototypeFolder[] => state.folders;
