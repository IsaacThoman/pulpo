import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Code2,
  Globe,
  ImagePlus,
  Lightbulb,
  Mic,
  Paperclip,
  Plus,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useChat } from '@/stores/chat'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'

export function Composer({
  chatId,
  modelId,
  centered,
}: {
  chatId: string | null
  modelId: string
  centered?: boolean
}) {
  const [value, setValue] = useState('')
  const [webSearch, setWebSearch] = useState(false)
  const [imageGen, setImageGen] = useState(false)
  const [codeInterp, setCodeInterp] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const sendMessage = useChat((s) => s.sendMessage)
  const streamingId = useChat((s) => s.streamingId)
  const stopStreaming = useChat((s) => s.stopStreaming)
  const sendWithEnter = useSettings((s) => s.sendWithEnter)

  useEffect(() => {
    ref.current?.focus()
  }, [chatId])

  const autosize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }

  const submit = () => {
    const text = value.trim()
    if (!text || streamingId) return
    sendMessage(chatId, text, modelId)
    setValue('')
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto'
    })
  }

  const toggle = (
    label: string,
    active: boolean,
    set: (v: boolean) => void,
    icon: React.ReactNode
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => set(!active)}
          className={cn(
            'flex size-8 cursor-pointer items-center justify-center rounded-full border transition-colors',
            active
              ? 'border-foreground/20 bg-secondary text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          aria-label={label}
          aria-pressed={active}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label} {active ? '(on)' : '(off)'}
      </TooltipContent>
    </Tooltip>
  )

  return (
    <div className={cn('w-full', centered && 'px-2')}>
      <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:shadow-md">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autosize()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && sendWithEnter && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder="Message…"
          className="max-h-[220px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Attach"
              >
                <Plus className="size-4.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52">
              <DropdownMenuItem>
                <Paperclip />
                Attach files
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ImagePlus />
                Upload image
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Lightbulb />
                Connect knowledge base
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {toggle('Web search', webSearch, setWebSearch, <Globe className="size-4" />)}
          {toggle('Image generation', imageGen, setImageGen, <ImagePlus className="size-4" />)}
          {toggle('Code interpreter', codeInterp, setCodeInterp, <Code2 className="size-4" />)}

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Voice input"
              >
                <Mic className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Dictate</TooltipContent>
          </Tooltip>

          {streamingId ? (
            <Button
              size="icon-sm"
              className="rounded-full"
              onClick={stopStreaming}
              aria-label="Stop generating"
            >
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              className="rounded-full"
              onClick={submit}
              disabled={!value.trim()}
              aria-label="Send message"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        kimi can make mistakes. check important info. · enter to send, shift+enter for newline
      </p>
    </div>
  )
}
