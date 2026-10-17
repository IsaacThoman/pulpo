import type { ReactElement } from 'react'
import { useLocation } from 'react-router-dom'
import { Columns2, MessageSquarePlus, PanelLeft, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import { addToChat, openInNewChat, splitView, useChatTarget, type FilesViewPlace } from './agent'
import { useSidePanel, type PanelContent } from './store'
import { mainViewContent, useMainNavigate } from './use-panel-actions'

function TipButton({ tip, children }: { tip: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  )
}

/** Moves a files view from the main view into the panel and opens a chat beside it. */
export function SplitViewButton({ view }: { view: PanelContent }) {
  const go = useMainNavigate()
  // No split without room for two views.
  const available = useSidePanel((state) => state.splitAvailable)
  if (!available) return null
  return (
    <TipButton tip={ui("Split view: move this to the side and open a chat")}>
      <Button variant="ghost" size="icon-sm" aria-label={ui("Split view")} onClick={() => splitView(view, go)}><Columns2 /></Button>
    </TipButton>
  )
}

/**
 * "Open to the left" for a chat's menu, the mirror of "Open to the right": what the main view shows
 * moves into the panel and the chat opens beside it. Offered only when the main view shows
 * something the panel can hold and there is room for both; otherwise it would just open the chat.
 * Without a chat, a new one opens.
 */
export function OpenChatToLeftItem({ chatId, shortcut }: { chatId?: string; shortcut?: string }) {
  const go = useMainNavigate()
  const { pathname } = useLocation()
  const available = useSidePanel((state) => state.splitAvailable)
  const view = mainViewContent(pathname)
  if (!view || !available) return null
  return (
    <DropdownMenuItem onSelect={() => splitView(view, go, chatId)}>
      <PanelLeft /> {ui("Open to the left")}
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
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
