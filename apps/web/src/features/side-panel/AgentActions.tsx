import type { ReactElement } from 'react'
import { Bot, ChevronDown, Columns2, MessageSquareCheck, MessageSquarePlus, SquarePen } from 'lucide-react'
import { focusComposer } from '@/components/chat/composer-focus'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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

/**
 * Agent controls for a file or folder view's header. On the page: split the view to the side,
 * or ask the agent in a new chat. Beside a chat: add the item to it, or start a new one.
 */
export function AgentActions({ item, place }: { item: AgentItem; place: FilesViewPlace }) {
  const go = useMainNavigate()
  const { target, scope } = useTargetScope()
  const shortcut = panelShortcut('J')

  if (place.layout === 'page') {
    return (
      <>
        <TipButton tip={ui("Split view: move this to the side and open a chat")}>
          <Button variant="outline" size="icon-sm" aria-label={ui("Split view")} onClick={() => splitView(place.view, go)}><Columns2 /></Button>
        </TipButton>
        <TipButton tip={`${ui("Ask about this in a new chat")} · ${shortcut}`}>
          <Button variant="outline" size="sm" onClick={() => openInNewChat([item.id], place, go)}>
            <Bot /> <span className="max-sm:sr-only">{ui("Ask agent")}</span>
          </Button>
        </TipButton>
      </>
    )
  }

  // In the panel header the agent controls are plain icons like the window controls beside them.
  if (!target) {
    return (
      <TipButton tip={`${ui("Ask about this in a new chat")} · ${shortcut}`}>
        <Button variant="ghost" size="icon-sm" aria-label={ui("Ask agent")} onClick={() => openInNewChat([item.id], place, go)}><SquarePen /></Button>
      </TipButton>
    )
  }

  const added = Boolean(scope && scopeIncludes(scope, item))
  const label = added ? ui("Already added to the chat") : ui("Add to the chat on the left")
  return (
    <div className="flex items-center">
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
      {target.kind === 'chat' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="w-4 text-muted-foreground" aria-label={ui("More agent actions")}><ChevronDown className="size-3.5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openInNewChat([item.id], place, go)}><SquarePen /> {ui("Open in new chat")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
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
