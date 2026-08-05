import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    multiRemove: vi.fn(async () => undefined),
  },
}));

const { setPreference } = vi.hoisted(() => ({ setPreference: vi.fn(async () => undefined) }));

vi.mock('../../../store/preferences', () => ({
  usePreferencesStore: { getState: () => ({ favoriteModelIds: [], setPreference }) },
}));

import { createSeedState } from '../seed';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LEGACY_PROTOTYPE_STORAGE_KEYS, purgeLegacyPrototypeSnapshots, usePrototypeStore } from './prototypeStore';
import { configureProductionActions } from '../production/productionActions';
import { useRealtimeStore } from '../../../providers/realtimeStore';

beforeEach(() => {
  usePrototypeStore.setState({ ...createSeedState(), productionNamespace: null, agentAvailable: false });
  useRealtimeStore.getState().setSyncError(null);
  configureProductionActions({ renameChat: async () => undefined });
});

describe('prototype store', () => {
  it('purges every legacy non-namespaced production snapshot', async () => {
    await purgeLegacyPrototypeSnapshots();
    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([...LEGACY_PROTOTYPE_STORAGE_KEYS]);
  });

  it('creates, renames, and deletes folders without deleting chats', () => {
    const folderId = usePrototypeStore.getState().addFolder('Launch');
    usePrototypeStore.getState().moveChat('c-kv', folderId);
    usePrototypeStore.getState().renameFolder(folderId, 'Launch planning');
    expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-kv')?.folderId).toBe(folderId);
    usePrototypeStore.getState().deleteFolder(folderId);
    expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-kv')?.folderId).toBeNull();
  });

  it('retains and restores trashed chats', () => {
    usePrototypeStore.getState().trashChat('c-kv');
    expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-kv')?.deletedAt).not.toBeNull();
    usePrototypeStore.getState().restoreChat('c-kv');
    expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-kv')?.deletedAt).toBeNull();
  });

  it('moves all active chats to trash in one local state transition', () => {
    usePrototypeStore.getState().trashAllChats();
    const chats = usePrototypeStore.getState().chats;
    expect(chats.every((chat) => chat.deletedAt !== null)).toBe(true);
    expect(chats.every((chat) => !chat.pinned)).toBe(true);
  });

  it('removes all chats locally when trash retention is disabled', () => {
    usePrototypeStore.getState().setPreference('trashRetention', 'instant');
    usePrototypeStore.getState().trashAllChats();
    expect(usePrototypeStore.getState().chats).toEqual([]);
  });

  it('deletes a message and every later message in its branch', () => {
    usePrototypeStore.getState().deleteMessageCascade('c-streaming', 'm-stream-user');
    expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-streaming')?.messages).toEqual([]);
  });

  it('discards a local chat when initial server creation fails', () => {
    const chat = usePrototypeStore.getState().chats[0]!;
    usePrototypeStore.getState().discardChat(chat.id);
    expect(usePrototypeStore.getState().chats.some((item) => item.id === chat.id)).toBe(false);
  });

  it('rolls back the latest optimistic action when the server rejects it', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    configureProductionActions({ renameChat: async () => { throw new Error('Rename rejected'); } });
    const original = usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-kv')!.title;

    usePrototypeStore.getState().renameChat('c-kv', 'Optimistic title');
    expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-kv')?.title).toBe('Optimistic title');
    await vi.waitFor(() => expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-kv')?.title).toBe(original));
    expect(useRealtimeStore.getState().syncError).toBe('Rename rejected');
    warning.mockRestore();
  });

  it('does not let an older failure overwrite a newer optimistic choice', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let rejectFirst!: (error: Error) => void;
    let call = 0;
    configureProductionActions({
      renameChat: async () => {
        call += 1;
        if (call === 1) await new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
      },
    });

    usePrototypeStore.getState().renameChat('c-kv', 'First title');
    usePrototypeStore.getState().renameChat('c-kv', 'Final title');
    rejectFirst(new Error('Older rename rejected'));
    await vi.waitFor(() => expect(useRealtimeStore.getState().syncError).toBe('Older rename rejected'));
    expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-kv')?.title).toBe('Final title');
    warning.mockRestore();
  });

});
