import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useChat } from '@/stores/chat'
import { askAgent, scopeCovers, useAgentContext } from './agent'
import { panelShortcut } from './shortcuts'
import { useSidePanel } from './store'

/** Opens the agent beside the page, or adds the page's file or folder to the open agent chat. */
export function AskAgentButton({ className }: { className?: string }) {
  const context = useAgentContext((state) => state.context)
  const content = useSidePanel((state) => state.content)
  const scope = useChat((state) => content?.kind === 'chat' && content.id
    ? state.chats.find((chat) => chat.id === content.id)?.fileScopeIds
    : undefined)
  const panelScope = content?.kind === 'chat' ? content.id === null ? content.scopeIds : scope ?? [] : null
  const active = Boolean(panelScope && context && scopeCovers(panelScope, context))
  const label = panelScope && context && !active ? ui("Add to agent chat") : ui("Ask agent")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={active}
          className={cn(active && 'bg-accent', className)}
          onClick={askAgent}
        >
          <Bot /> <span className="max-sm:sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{`${label} · ${panelShortcut('J')}`}</TooltipContent>
    </Tooltip>
  )
}
