import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Mic,
  Plus,
  Square,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useChat } from '@/stores/chat'
import { useSettings } from '@/stores/settings'
import { chatOptionsFor, resolveGeneration, useModelConfig } from '@/stores/modelConfig'
import { getModel } from '@/lib/mock'
import type { ReasoningEffort, SpeedOption } from '@/lib/types'
import { cn } from '@/lib/utils'

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const SPEED_LABELS: Record<SpeedOption, string> = {
  standard: 'Standard',
  fast: 'Fast',
}

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
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendMessage = useChat((s) => s.sendMessage)
  const streamingId = useChat((s) => s.streamingId)
  const stopStreaming = useChat((s) => s.stopStreaming)
  const sendWithEnter = useSettings((s) => s.sendWithEnter)
  const overrides = useModelConfig((s) => s.overrides)
  const generation = useSettings((s) => s.generation)
  const setGeneration = useSettings((s) => s.setGeneration)

  const options = chatOptionsFor(getModel(modelId), overrides)
  const prefs = resolveGeneration(options, generation[modelId])
  const showEffort = options.reasoningEfforts.length > 0
  const showSpeed = options.speedOptions.length > 1

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
          <input ref={fileInputRef} type="file" multiple className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Attach files"
          >
            <Plus className="size-4.5" />
          </button>

          {(showEffort || showSpeed) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Generation options"
                >
                  {showEffort && <Brain className="size-3.5" />}
                  {showEffort && prefs.reasoningEffort && (
                    <span>{EFFORT_LABELS[prefs.reasoningEffort]}</span>
                  )}
                  {showEffort && showSpeed && <span className="text-border">·</span>}
                  {showSpeed && <Zap className="size-3.5" />}
                  {showSpeed && prefs.speed && <span>{SPEED_LABELS[prefs.speed]}</span>}
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-44">
                {showEffort && (
                  <>
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                      <Brain className="size-3.5" /> Reasoning effort
                    </DropdownMenuLabel>
                    {options.reasoningEfforts.map((effort) => (
                      <DropdownMenuItem
                        key={effort}
                        onClick={() => setGeneration(modelId, { reasoningEffort: effort })}
                        className="justify-between"
                      >
                        {EFFORT_LABELS[effort]}
                        {prefs.reasoningEffort === effort && <Check className="size-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {showEffort && showSpeed && <DropdownMenuSeparator />}
                {showSpeed && (
                  <>
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                      <Zap className="size-3.5" /> Speed
                    </DropdownMenuLabel>
                    {options.speedOptions.map((speed) => (
                      <DropdownMenuItem
                        key={speed}
                        onClick={() => setGeneration(modelId, { speed })}
                        className="justify-between"
                      >
                        {SPEED_LABELS[speed]}
                        {prefs.speed === speed && <Check className="size-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

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
    </div>
  )
}
