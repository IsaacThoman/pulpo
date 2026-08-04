import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { createSeedState } from '../seed';
import { usePrototypeStore } from './prototypeStore';

beforeEach(() => {
  usePrototypeStore.setState({ ...createSeedState(), hydrated: true });
});

describe('prototype store', () => {
  it('runs the pending approval authentication flow', () => {
    usePrototypeStore.getState().signUp('Ada Lovelace', 'ada@example.com');
    expect(usePrototypeStore.getState().session.status).toBe('pending');
    usePrototypeStore.getState().approvePendingDemo();
    expect(usePrototypeStore.getState().session.status).toBe('signed-in');
    expect(usePrototypeStore.getState().session.user?.role).toBe('member');
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

  it('deletes a message and every later message in its branch', () => {
    usePrototypeStore.getState().deleteMessageCascade('c-streaming', 'm-stream-user');
    expect(usePrototypeStore.getState().chats.find((chat) => chat.id === 'c-streaming')?.messages).toEqual([]);
  });

  it('restores the complete seeded showcase', () => {
    usePrototypeStore.getState().setPreference('theme', 'light');
    usePrototypeStore.getState().emptyTrash();
    usePrototypeStore.getState().resetDemo();
    expect(usePrototypeStore.getState().preferences.theme).toBe('system');
    expect(usePrototypeStore.getState().chats.some((chat) => chat.deletedAt !== null)).toBe(true);
  });
});
