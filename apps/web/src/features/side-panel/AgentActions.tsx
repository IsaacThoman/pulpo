import type { ReactElement } from 'react'
import { Columns2, MessageSquareCheck, MessageSquarePlus, SquarePen } from 'lucide-react'
import { focusComposer } from '@/components/chat/composer-focus'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import {
  addToChat,
  openInNewChat,
  scopeIncludes,
  splitView,
  targetScope,
  useChatTarget,
  useNewChatScope,
  type AgentItem,
  type FilesViewPlace,
} from './agent'
import { panelShortcut } from './shortcuts'
import type { PanelContent } from './store'
import { useMainNavigate } from './use-panel-actions'

function TipButton({ tip, children }: { tip: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  )
}

/** The chat on the left and its Files scope, kept current. */
function useTargetScope() {
  const target = useChatTarget((state) => state.target)
  const draft = useNewChatScope((state) => state.scopeIds)
  const chats = useChat((state) => target?.kind === 'chat' ? state.chats : undefined)
  return { target, scope: targetScope(target, chats, draft) }
}

/** Agent controls for a file or folder view's header, the same on the page and in the panel. */
export function AgentActions({ item, place }: { item: AgentItem; place: FilesViewPlace }) {
  const go = useMainNavigate()
  const { target, scope } = useTargetScope()
  const shortcut = panelShortcut('J')

  // Plain icons, like the window controls beside them. Without a chat on the left (always so on
  // the page) the agent starts one; beside a chat it adds to that chat, or starts a new one.
  const newChat = (
    <TipButton tip={`${ui("Ask about this in a new chat")}${place.layout === 'page' || !target ? ` · ${shortcut}` : ''}`}>
      <Button variant="ghost" size="icon-sm" aria-label={target && place.layout === 'panel' ? ui("Open in new chat") : ui("Ask agent")} onClick={() => openInNewChat([item.id], place, go)}><SquarePen /></Button>
    </TipButton>
  )
  if (place.layout === 'page' || !target) return newChat

  const added = Boolean(scope && scopeIncludes(scope, item))
  const label = added ? ui("Already added to the chat") : ui("Add to the chat on the left")
  return (
    <>
      {target.kind === 'chat' && newChat}
      <TipButton tip={added ? label : `${label} · ${shortcut}`}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={added ? ui("In chat") : ui("Add to chat")}
          aria-pressed={added}
          className={cn(added && 'bg-accent text-foreground')}
          onClick={() => added ? focusComposer() : addToChat([item.id])}
        >
          {added ? <MessageSquareCheck /> : <MessageSquarePlus />}
        </Button>
      </TipButton>
    </>
  )
}

/** Moves a files view from the main view into the panel and opens a chat beside it. */
export function SplitViewButton({ view }: { view: PanelContent }) {
  const go = useMainNavigate()
  return (
    <TipButton tip={ui("Split view: move this to the side and open a chat")}>
      <Button variant="ghost" size="icon-sm" aria-label={ui("Split view")} onClick={() => splitView(view, go)}><Columns2 /></Button>
    </TipButton>
  )
}

/** Agent entries for a files right-click menu, matching the chat on the left. */
export function AgentMenuItems({ ids, place }: { ids: string[]; place: FilesViewPlace }) {
  const go = useMainNavigate()
  const target = useChatTarget((state) => state.target)
  const inPanel = place.layout === 'panel' && target
  return (
    <>
      {inPanel && (
        <DropdownMenuItem onSelect={() => addToChat(ids)}>
          <MessageSquarePlus /> {target.kind === 'chat' ? ui("Add to current chat") : ui("Add to chat")}
        </DropdownMenuItem>
      )}
      {(!inPanel || target.kind === 'chat') && (
        <DropdownMenuItem onSelect={() => openInNewChat(ids, place, go)}>
          <SquarePen /> {ui("Open in new chat")}
        </DropdownMenuItem>
      )}
    </>
  )
}
