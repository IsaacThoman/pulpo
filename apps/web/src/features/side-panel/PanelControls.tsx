import type { ReactNode } from 'react'
import { ExternalLink, Maximize2, Minimize2, SquareArrowOutUpRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import type { PanelContent } from './store'
import { isApplePlatform, panelShortcut } from './shortcuts'
import { usePanelActions } from './use-panel-actions'


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

/** Open in a new tab, maximize/restore, and close, at the end of every panel header. */
export function PanelWindowButtons({ content }: { content: PanelContent }) {
  const actions = usePanelActions(content)
  const elsewhere = actions.openElsewhere
  return (
    <>
      {elsewhere && (
        <IconButton label={elsewhere.newTab ? ui("Open in new tab") : ui("Open as page")} onClick={elsewhere.run}>
          {elsewhere.newTab ? <ExternalLink /> : <SquareArrowOutUpRight />}
        </IconButton>
      )}
      <IconButton
        label={actions.maximized ? ui("Restore split view") : ui("Maximize panel")}
        shortcut={isApplePlatform ? '⌘⇧↵' : 'Ctrl+Shift+Enter'}
        onClick={actions.toggleMaximized}
      >
        {actions.maximized ? <Minimize2 /> : <Maximize2 />}
      </IconButton>
      <IconButton label={ui("Close panel")} shortcut={panelShortcut('\\')} onClick={actions.close}><X /></IconButton>
    </>
  )
}
