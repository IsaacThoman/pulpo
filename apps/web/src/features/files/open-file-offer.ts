import { useEffect } from 'react'
import { FILE_SCOPE_ROOT, MAX_CHAT_FILE_SCOPES, type FileNode } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'
import { useFilesViews } from '@/features/side-panel/agent'
import { mainTabs, useMainTabs } from '@/features/side-panel/main-tabs'
import { activeTab } from '@/features/side-panel/pane-tabs'
import { useScopeNode } from './scope-node'

/**
 * The Files item the user has open: what the side panel shows beside the chat, else the file in
 * the main view's active tab. Null once it is attached, when no more fit, or when it cannot be added
 * (trashed, gone, or still loading).
 */
export function useOpenFileOffer(selected: readonly string[]): { id: string; name: string; node: FileNode | null } | null {
  const userId = useAuth((state) => state.user?.id)
  // The menu may open before any Files view has this session.
  useEffect(() => mainTabs.load(userId), [userId])
  const panelId = useFilesViews((state) => state.panel?.item.id ?? null)
  const tabFileId = useMainTabs((state) => {
    // Tabs left by another account on this device are not this one's.
    const content = state.userId === userId ? activeTab(state)?.content : undefined
    return content?.kind === 'file' ? content.id : null
  })
  const id = panelId ?? tabFileId
  const { node, missing } = useScopeNode(id ?? FILE_SCOPE_ROOT)
  if (!id || missing || selected.includes(id) || selected.length >= MAX_CHAT_FILE_SCOPES) return null
  if (id === FILE_SCOPE_ROOT) return { id, name: ui("My files"), node: null }
  return node ? { id, name: node.name, node } : null
}
