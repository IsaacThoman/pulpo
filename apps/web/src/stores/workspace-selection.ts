import { create } from 'zustand'
import type { WorkspaceSelection } from '@pulpo/contracts'

export const NEW_CHAT_WORKSPACE_KEY = 'new'

interface WorkspaceSelectionState {
  /** Keyed by chat id, or `new` for the next chat the composer starts. Absent means the cloud sandbox. */
  selections: Record<string, WorkspaceSelection>
  select: (chatKey: string, selection: WorkspaceSelection) => void
  clear: (chatKey: string) => void
}

/**
 * Which workspace the composer will ask for on the next agent message. The server makes the
 * choice sticky per chat, so this only matters for a chat's first agent response.
 */
export const useWorkspaceSelection = create<WorkspaceSelectionState>((set) => ({
  selections: {},
  select: (chatKey, selection) => set((state) => ({ selections: { ...state.selections, [chatKey]: selection } })),
  clear: (chatKey) => set((state) => {
    const next = { ...state.selections }
    delete next[chatKey]
    return { selections: next }
  }),
}))

export function workspaceSelectionFor(chatId: string | null | undefined): WorkspaceSelection | null {
  return useWorkspaceSelection.getState().selections[chatId ?? NEW_CHAT_WORKSPACE_KEY] ?? null
}
