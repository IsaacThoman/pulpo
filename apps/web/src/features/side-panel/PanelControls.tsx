import type { ReactNode } from 'react'
import { ExternalLink, Maximize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import type { PanelContent } from './store'
import { isApplePlatform, panelShortcut } from './shortcuts'
import { usePanelActions } from './use-panel-actions'


function IconButton({ label, shortcut, onClick, className, children }: { label: string; shortcut?: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={className} aria-label={label} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{shortcut ? `${label} · ${shortcut}` : label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Open in a new browser tab, open in the main view, and close, for what the panel shows: at the
 * end of the panel's tab strip (`strip`, sized like the strip's own buttons), or of its header
 * when it has no tabs.
 */
export function PanelWindowButtons({ content, strip = false }: { content: PanelContent; strip?: boolean }) {
  const actions = usePanelActions(content)
  const className = strip ? 'desktop-no-drag size-7 shrink-0 hover:bg-sidebar-accent' : undefined
  return (
    <>
      {/* A narrow strip leaves this one out; the panel's other buttons and its tabs need the room. */}
      {actions.openInNewTab && <IconButton label={ui("Open in new browser tab")} className={cn(className, strip && '@max-[26rem]/strip:hidden')} onClick={actions.openInNewTab}><ExternalLink /></IconButton>}
      <IconButton label={ui("Open in main view")} shortcut={isApplePlatform ? '⌘⇧↵' : 'Ctrl+Shift+Enter'} className={className} onClick={actions.openInMain}>
        <Maximize2 />
      </IconButton>
      <IconButton label={ui("Close panel")} shortcut={panelShortcut('\\')} className={className} onClick={actions.close}><X /></IconButton>
    </>
  )
}
