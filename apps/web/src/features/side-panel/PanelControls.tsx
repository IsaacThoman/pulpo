import type { ReactNode } from 'react'
import { ArrowLeftRight, Maximize2, Minimize2, SquareArrowOutUpRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import type { PanelContent } from './store'
import { usePanelActions } from './use-panel-actions'

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isApple ? '⌘' : 'Ctrl+'

function IconButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{shortcut ? `${label} · ${shortcut}` : label}</TooltipContent>
    </Tooltip>
  )
}

/** Maximize/restore and close, at the end of every panel header. */
export function PanelWindowButtons({ content }: { content: PanelContent }) {
  const actions = usePanelActions(content)
  return (
    <>
      <IconButton
        label={actions.maximized ? ui("Restore split view") : ui("Maximize panel")}
        shortcut={isApple ? '⌘⇧↵' : 'Ctrl+Shift+Enter'}
        onClick={actions.toggleMaximized}
      >
        {actions.maximized ? <Minimize2 /> : <Maximize2 />}
      </IconButton>
      <IconButton label={ui("Close panel")} shortcut={`${mod}\\`} onClick={actions.close}><X /></IconButton>
    </>
  )
}

/** Less frequent panel actions for a header's "⋯" menu. */
export function PanelMenuItems({ content }: { content: PanelContent }) {
  const actions = usePanelActions(content)
  return (
    <>
      <DropdownMenuItem onSelect={actions.openAsPage}><SquareArrowOutUpRight /> {ui("Open as page")}</DropdownMenuItem>
      {actions.swap && <DropdownMenuItem onSelect={actions.swap}><ArrowLeftRight /> {ui("Swap sides")}</DropdownMenuItem>}
    </>
  )
}
