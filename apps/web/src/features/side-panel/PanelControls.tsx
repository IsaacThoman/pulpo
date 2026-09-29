import type { ReactNode } from 'react'
import { ExternalLink, Maximize2, X } from 'lucide-react'
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

/** Open in a new tab, open in the main view, and close, at the end of every panel header. */
export function PanelWindowButtons({ content }: { content: PanelContent }) {
  const actions = usePanelActions(content)
  return (
    <>
      {actions.openInNewTab && <IconButton label={ui("Open in new tab")} onClick={actions.openInNewTab}><ExternalLink /></IconButton>}
      <IconButton label={ui("Open in main view")} shortcut={isApplePlatform ? '⌘⇧↵' : 'Ctrl+Shift+Enter'} onClick={actions.openInMain}>
        <Maximize2 />
      </IconButton>
      <IconButton label={ui("Close panel")} shortcut={panelShortcut('\\')} onClick={actions.close}><X /></IconButton>
    </>
  )
}
