import type { ReactElement } from 'react'
import { Columns2, MessageSquarePlus, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import { addToChat, openInNewChat, splitView, useChatTarget, type FilesViewPlace } from './agent'
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
