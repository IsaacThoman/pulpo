import type { ReactElement } from 'react'
import { Bot, ChevronDown, Columns2, MessageSquarePlus } from 'lucide-react'
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

  if (place.layout === 'page' || !target) {
    return (
      <>
        {place.layout === 'page' && (
          <TipButton tip={ui("Split view: move this to the side and open a chat")}>
            <Button variant="outline" size="icon-sm" aria-label={ui("Split view")} onClick={() => splitView(place.view, go)}><Columns2 /></Button>
          </TipButton>
        )}
        <TipButton tip={`${ui("Ask about this in a new chat")} · ${shortcut}`}>
          <Button variant="outline" size="sm" onClick={() => openInNewChat([item.id], place, go)}>
            <Bot /> <span className="max-sm:sr-only">{ui("Ask agent")}</span>
          </Button>
        </TipButton>
      </>
    )
  }

  const covered = Boolean(scope && scopeIncludes(scope, item))
  const add = (
    <TipButton tip={covered ? ui("Already added to the chat") : `${ui("Add to the chat on the left")} · ${shortcut}`}>
      <Button
        variant="outline"
        size="sm"
        aria-pressed={covered}
        className={cn(covered && 'bg-accent', target.kind === 'chat' && 'rounded-r-none')}
        onClick={() => covered ? focusComposer() : addToChat([item.id])}
      >
        <Bot /> <span className="max-sm:sr-only">{covered ? ui("In chat") : ui("Add to chat")}</span>
      </Button>
    </TipButton>
  )
  if (target.kind === 'new') return add
  return (
    <div className="flex">
      {add}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" className="w-7 rounded-l-none border-l-0" aria-label={ui("More agent actions")}><ChevronDown /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openInNewChat([item.id], place, go)}><MessageSquarePlus /> {ui("Open in new chat")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
          <Bot /> {target.kind === 'chat' ? ui("Add to current chat") : ui("Add to chat")}
        </DropdownMenuItem>
      )}
      {(!inPanel || target.kind === 'chat') && (
        <DropdownMenuItem onSelect={() => openInNewChat(ids, place, go)}>
          {inPanel ? <MessageSquarePlus /> : <Bot />} {ui("Open in new chat")}
        </DropdownMenuItem>
      )}
    </>
  )
}
