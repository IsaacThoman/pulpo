import { useEffect } from 'react'
import { create } from 'zustand'
import { FILE_SCOPE_ROOT } from '@pulpo/contracts'
import { focusSidePanelComposer } from '@/components/chat/composer-focus'
import { extendFileScope } from '@/features/files/file-scope-cache'
import { useChat } from '@/stores/chat'
import { useSidePanel } from './store'

/** What the main view shows that the agent could work on: a file, a folder, or all files. */
export interface AgentContext {
  /** A file or folder id, or `root`. */
  id: string
  /** Folders above it, outermost first, so a scope that already covers it is recognized. */
  ancestorIds: string[]
}

export const useAgentContext = create<{ context: AgentContext | null }>()(() => ({ context: null }))

/** Offers the page's file or folder to "Ask agent" while the page is shown. */
export function usePublishAgentContext(context: AgentContext | null): void {
  const id = context?.id
  const ancestors = context?.ancestorIds.join(',') ?? ''
  useEffect(() => {
    if (!id) return
    const published = { id, ancestorIds: ancestors ? ancestors.split(',') : [] }
    useAgentContext.setState({ context: published })
    return () => { if (useAgentContext.getState().context === published) useAgentContext.setState({ context: null }) }
  }, [ancestors, id])
}

/** Whether a chat scope already reaches the context, directly or through a folder above it. */
export function scopeCovers(scope: readonly string[], context: AgentContext): boolean {
  return scope.includes(FILE_SCOPE_ROOT) || [context.id, ...context.ancestorIds].some((id) => scope.includes(id))
}

/**
 * Brings up the agent for what the main view shows. An agent chat already in the panel gains the
 * file or folder; otherwise a new chat opens beside the page, scoped to it.
 */
export function askAgent(): void {
  const context = useAgentContext.getState().context
  const scope = context ? [context.id] : []
  const panel = useSidePanel.getState()
  const content = panel.content
  if (content?.kind === 'chat') {
    if (content.id === null) {
      if (context && !scopeCovers(content.scopeIds, context)) panel.open({ ...content, scopeIds: extendFileScope(content.scopeIds, scope) })
    } else {
      const chat = useChat.getState().chats.find((item) => item.id === content.id)
      if (!chat || chat.temporary) {
        panel.open({ kind: 'chat', id: null, scopeIds: scope })
      } else if (context && !scopeCovers(chat.fileScopeIds ?? [], context)) {
        useChat.getState().setChatFileScope(chat.id, extendFileScope(chat.fileScopeIds ?? [], scope))
      }
    }
    requestAnimationFrame(() => focusSidePanelComposer())
    return
  }
  // A new chat's composer focuses itself when it mounts.
  panel.open({ kind: 'chat', id: null, scopeIds: scope })
}

/** Cmd/Ctrl+J: hides an open agent chat, or asks the agent about the current page. */
export function toggleAgent(): void {
  if (useSidePanel.getState().content?.kind === 'chat') useSidePanel.getState().close()
  else askAgent()
}
