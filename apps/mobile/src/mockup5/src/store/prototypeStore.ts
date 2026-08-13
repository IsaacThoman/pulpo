import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type {
  AppPreferences, PersistedPrototypeState,
  PrototypeChat, PrototypeFolder, PrototypeMessage, SessionState,
} from '../domain';
import { createInitialState } from '../initialState';
import { productionActions, runProductionAction } from '../production/productionActions';
import { useRealtimeStore } from '../../../providers/realtimeStore';
import { usePreferencesStore } from '../../../store/preferences';

type PrototypeActions = {
  productionNamespace: string | null;
  productionScopeReady: boolean;
  modelCatalogReady: boolean;
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
  setChatAutoExpiration: (id: string, enabled: boolean) => void;
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
const productionPreferenceKeys = new Set(['theme', 'textSize', 'streamResponses', 'showReasoning', 'haptics', 'sendWithEnter', 'attachmentCacheMb', 'localChatLimit', 'trashRetention', 'automaticChatExpiration', 'newChatAutoExpire']);
const actionVersions = new Map<string, number>();

function automaticExpirationDeadline(now = Date.now()): number | null {
  const preference = usePrototypeStore.getState().preferences.automaticChatExpiration;
  if (preference === '24h') return now + 86_400_000;
  if (preference === '7d') return now + 604_800_000;
  return null;
}

function runOptimisticAction(key: string, action: Promise<unknown>, rollback: () => void): void {
  const namespace = usePrototypeStore.getState().productionNamespace;
  const scopedKey = `${namespace ?? 'local'}:${key}`;
  const version = (actionVersions.get(scopedKey) ?? 0) + 1;
  actionVersions.set(scopedKey, version);
  runProductionAction(action, {
    rollback: () => {
      if (usePrototypeStore.getState().productionNamespace === namespace && actionVersions.get(scopedKey) === version) rollback();
    },
    onError: (error) => {
      if (usePrototypeStore.getState().productionNamespace !== namespace) return;
      useRealtimeStore.getState().setSyncError(error instanceof Error ? error.message : 'The change could not be saved.');
    },
  });
}

export const usePrototypeStore = create<PrototypeStore>()((set, get) => ({
  ...createInitialState(),
  productionNamespace: null, productionScopeReady: false, modelCatalogReady: false, agentAvailable: false,
  updateProfile: (patch) => set((state) => state.session.user ? { session: { ...state.session, user: { ...state.session.user, ...patch, initials: patch.name ? initialsFor(patch.name) : state.session.user.initials } } } : {}),
  setPreference: (key, value) => {
    const previous = get().preferences[key];
    set((state) => ({ preferences: { ...state.preferences, [key]: value } }));
    if (productionPreferenceKeys.has(key)) runOptimisticAction(
      `preference:${String(key)}`,
      productionActions.setPreference(key as never, value as never),
      () => {
        set((state) => ({ preferences: { ...state.preferences, [key]: previous } }));
        void usePreferencesStore.getState().setPreference(key as never, previous as never);
      },
    );
  },
  addFolder: (name) => {
    const folderId = id('folder');
    const trimmed = name.trim();
    set((state) => ({ folders: [...state.folders, { id: folderId, name: trimmed, expanded: true }] }));
    runOptimisticAction(`folder:${folderId}:create`, productionActions.createFolder(trimmed, folderId), () => set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== folderId),
      chats: state.chats.map((chat) => chat.folderId === folderId ? { ...chat, folderId: null } : chat),
    })));
    return folderId;
  },
  renameFolder: (folderId, name) => {
    const previous = get().folders.find((folder) => folder.id === folderId)?.name;
    const trimmed = name.trim();
    set((state) => ({ folders: state.folders.map((folder) => folder.id === folderId ? { ...folder, name: trimmed } : folder) }));
    runOptimisticAction(`folder:${folderId}:name`, productionActions.renameFolder(folderId, trimmed), () => {
      if (previous === undefined) return;
      set((state) => ({ folders: state.folders.map((folder) => folder.id === folderId ? { ...folder, name: previous } : folder) }));
    });
  },
  deleteFolder: (folderId) => {
    const previous = get().folders.find((folder) => folder.id === folderId);
    const previousIndex = get().folders.findIndex((folder) => folder.id === folderId);
    const chatIds = new Set(get().chats.filter((chat) => chat.folderId === folderId).map((chat) => chat.id));
    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== folderId),
      chats: state.chats.map((chat) => chat.folderId === folderId ? { ...chat, folderId: null } : chat),
    }));
    runOptimisticAction(`folder:${folderId}:delete`, productionActions.deleteFolder(folderId), () => {
      if (!previous) return;
      set((state) => {
        const folders = [...state.folders];
        if (!folders.some((folder) => folder.id === folderId)) folders.splice(Math.max(0, previousIndex), 0, previous);
        return {
          folders,
          chats: state.chats.map((chat) => chatIds.has(chat.id) && chat.folderId === null ? { ...chat, folderId } : chat),
        };
      });
    });
  },
  toggleFolder: (folderId) => set((state) => ({ folders: state.folders.map((folder) => folder.id === folderId ? { ...folder, expanded: !folder.expanded } : folder) })),
  upsertChat: (chat) => set((state) => ({ chats: state.chats.some((item) => item.id === chat.id) ? state.chats.map((item) => item.id === chat.id ? chat : item) : [chat, ...state.chats] })),
  discardChat: (chatId) => set((state) => ({ chats: state.chats.filter((chat) => chat.id !== chatId) })),
  renameChat: (chatId, title) => {
    const previous = get().chats.find((chat) => chat.id === chatId);
    const trimmed = title.trim();
    set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, title: trimmed, updatedAt: Date.now() } : chat) }));
    runOptimisticAction(`chat:${chatId}:title`, productionActions.renameChat(chatId, trimmed), () => {
      if (!previous) return;
      set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, title: previous.title, updatedAt: previous.updatedAt } : chat) }));
    });
  },
  togglePin: (chatId) => {
    const previous = get().chats.find((chat) => chat.id === chatId)?.pinned;
    const next = !previous;
    set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, pinned: next } : chat) }));
    runOptimisticAction(`chat:${chatId}:pinned`, productionActions.togglePin(chatId, next), () => {
      if (previous === undefined) return;
      set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, pinned: previous } : chat) }));
    });
  },
  moveChat: (chatId, folderId) => {
    const previous = get().chats.find((chat) => chat.id === chatId)?.folderId;
    set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, folderId } : chat) }));
    runOptimisticAction(`chat:${chatId}:folder`, productionActions.moveChat(chatId, folderId), () => {
      if (previous === undefined) return;
      set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, folderId: previous } : chat) }));
    });
  },
  setChatAutoExpiration: (chatId, enabled) => {
    const current = get().chats.find((chat) => chat.id === chatId);
    if (!current || current.temporary) return;
    const previous = current.expiresAt ?? null;
    const expiresAt = enabled ? automaticExpirationDeadline() : null;
    if (enabled && expiresAt === null) return;
    set((state) => ({
      chats: state.chats.map((chat) => chat.id === chatId && !chat.temporary ? { ...chat, expiresAt } : chat),
    }));
    runOptimisticAction(`chat:${chatId}:expiration`, productionActions.setChatAutoExpiration(chatId, enabled), () => {
      set((state) => ({
        chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, expiresAt: previous } : chat),
      }));
    });
  },
  trashChat: (chatId) => {
    const previous = get().chats.find((chat) => chat.id === chatId);
    const previousIndex = get().chats.findIndex((chat) => chat.id === chatId);
    set((state) => {
    const duration = retentionMs[state.preferences.trashRetention];
    if (duration === 0) return { chats: state.chats.filter((chat) => chat.id !== chatId) };
    const deletedAt = Date.now();
    return { chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, deletedAt, expiresAt: null, purgeAt: duration === null ? null : deletedAt + duration, pinned: false } : chat) };
    });
    runOptimisticAction(`chat:${chatId}:deleted`, productionActions.trashChat(chatId), () => {
      if (!previous) return;
      set((state) => {
        const existing = state.chats.findIndex((chat) => chat.id === chatId);
        if (existing < 0) {
          const chats = [...state.chats];
          chats.splice(Math.max(0, previousIndex), 0, previous);
          return { chats };
        }
        return { chats: state.chats.map((chat) => chat.id === chatId ? {
          ...chat, deletedAt: previous.deletedAt, expiresAt: previous.expiresAt, purgeAt: previous.purgeAt, pinned: previous.pinned,
        } : chat) };
      });
    });
  },
  trashAllChats: () => {
    const previous = get().chats;
    set((state) => {
      const duration = retentionMs[state.preferences.trashRetention];
      if (duration === 0) return { chats: [] };
      const deletedAt = Date.now();
      return { chats: state.chats.map((chat) => chat.deletedAt === null ? {
        ...chat,
        deletedAt,
        expiresAt: null,
        purgeAt: duration === null ? null : deletedAt + duration,
        pinned: false,
      } : chat) };
    });
    runOptimisticAction('chats:all:deleted', productionActions.trashAllChats(), () => set((state) => {
      const previousById = new Map(previous.map((chat) => [chat.id, chat]));
      const currentIds = new Set(state.chats.map((chat) => chat.id));
      return {
        chats: [
          ...state.chats.map((chat) => {
            const before = previousById.get(chat.id);
            return before && before.deletedAt === null
              ? { ...chat, deletedAt: before.deletedAt, expiresAt: before.expiresAt, purgeAt: before.purgeAt, pinned: before.pinned }
              : chat;
          }),
          ...previous.filter((chat) => !currentIds.has(chat.id)),
        ],
      };
    }));
  },
  restoreChat: (chatId) => {
    const previous = get().chats.find((chat) => chat.id === chatId);
    set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? { ...chat, deletedAt: null, expiresAt: null, purgeAt: null, updatedAt: Date.now() } : chat) }));
    runOptimisticAction(`chat:${chatId}:deleted`, productionActions.restoreChat(chatId), () => {
      if (!previous) return;
      set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? {
        ...chat, deletedAt: previous.deletedAt, expiresAt: previous.expiresAt, purgeAt: previous.purgeAt, updatedAt: previous.updatedAt,
      } : chat) }));
    });
  },
  permanentlyDeleteChat: (chatId) => {
    const previous = get().chats.find((chat) => chat.id === chatId);
    const previousIndex = get().chats.findIndex((chat) => chat.id === chatId);
    set((state) => ({ chats: state.chats.filter((chat) => chat.id !== chatId) }));
    runOptimisticAction(`chat:${chatId}:permanent`, productionActions.permanentlyDeleteChat(chatId), () => {
      if (!previous) return;
      set((state) => {
        if (state.chats.some((chat) => chat.id === chatId)) return state;
        const chats = [...state.chats];
        chats.splice(Math.max(0, previousIndex), 0, previous);
        return { chats };
      });
    });
  },
  emptyTrash: () => {
    const previousDeleted = get().chats.filter((chat) => chat.deletedAt !== null);
    set((state) => ({ chats: state.chats.filter((chat) => chat.deletedAt === null) }));
    runOptimisticAction('trash:all:permanent', productionActions.emptyTrash(), () => set((state) => {
      const currentIds = new Set(state.chats.map((chat) => chat.id));
      return { chats: [...state.chats, ...previousDeleted.filter((chat) => !currentIds.has(chat.id))] };
    }));
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
  setDefaultModel: (defaultModelId) => {
    const previous = get().defaultModelId;
    set({ defaultModelId });
    runOptimisticAction('preference:defaultModelId', productionActions.setPreference('defaultModelId', defaultModelId), () => {
      set({ defaultModelId: previous });
      void usePreferencesStore.getState().setPreference('defaultModelId', previous);
    });
  },
  toggleFavoriteModel: (modelId) => {
    const previous = get().models.find((model) => model.id === modelId)?.favorite;
    const previousIds = usePreferencesStore.getState().favoriteModelIds;
    const favorite = !previous;
    set((state) => ({ models: state.models.map((model) => model.id === modelId ? { ...model, favorite: !model.favorite } : model) }));
    runOptimisticAction(`model:${modelId}:favorite`, productionActions.toggleFavoriteModel(modelId, favorite), () => {
      if (previous === undefined) return;
      set((state) => ({ models: state.models.map((model) => model.id === modelId ? { ...model, favorite: previous } : model) }));
      void usePreferencesStore.getState().setPreference('favoriteModelIds', previousIds);
    });
  },
}));

export const selectFolders = (state: PrototypeStore): PrototypeFolder[] => state.folders;
