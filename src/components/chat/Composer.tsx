import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, Mic, Plus, Square } from 'lucide-react'
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
import { chatOptionsFor, resolveSelections, useModelConfig } from '@/stores/modelConfig'
import { getModel } from '@/lib/mock'
import { PresetIcon } from '@/components/chat/PresetIcon'
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
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendMessage = useChat((s) => s.sendMessage)
  const streamingId = useChat((s) => s.streamingId)
  const stopStreaming = useChat((s) => s.stopStreaming)
  const sendWithEnter = useSettings((s) => s.sendWithEnter)
  const overrides = useModelConfig((s) => s.overrides)
  const generation = useSettings((s) => s.generation)
  const setPresetChoice = useSettings((s) => s.setPresetChoice)

  const options = chatOptionsFor(getModel(modelId), overrides)
  const selections = resolveSelections(options, generation[modelId])
  const activePresets = options.presets.filter((p) => p.choices.length > 0)

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

          {activePresets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Generation options"
                >
                  {activePresets.map((preset, i) => {
                    const choice = preset.choices.find((c) => c.id === selections[preset.id])
                    const icon = choice?.icon ?? preset.icon
                    return (
                      <span key={preset.id} className="flex items-center gap-1">
                        {i > 0 && <span className="text-border">·</span>}
                        <PresetIcon name={icon} />
                        {choice && <span>{choice.displayName}</span>}
                      </span>
                    )
                  })}
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-48">
                {activePresets.map((preset, i) => (
                  <div key={preset.id}>
                    {i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                      <PresetIcon name={preset.icon} />
                      {preset.name}
                    </DropdownMenuLabel>
                    {preset.choices.map((choice) => (
                      <DropdownMenuItem
                        key={choice.id}
                        onClick={() => setPresetChoice(modelId, preset.id, choice.id)}
                        className="justify-between"
                      >
                        <span className="flex items-center gap-1.5">
                          <PresetIcon name={choice.icon ?? preset.icon} className="opacity-70" />
                          {choice.displayName}
                        </span>
                        {selections[preset.id] === choice.id && <Check className="size-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
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
