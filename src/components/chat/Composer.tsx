import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, Check, ChevronDown, Loader2, Mic, Paperclip, Plus, Square, X } from 'lucide-react'
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
import { getCatalogModel } from '@/stores/catalog'
import { PresetIcon } from '@/components/chat/PresetIcon'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'

interface PendingAttachment {
  id: string
  name: string
  size: number
}

export function Composer({
  chatId,
  modelId,
  centered,
  temporary = false,
}: {
  chatId: string | null
  modelId: string
  centered?: boolean
  temporary?: boolean
}) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendMessage = useChat((s) => s.sendMessage)
  const streamingId = useChat((s) => s.streamingId)
  const stopStreaming = useChat((s) => s.stopStreaming)
  const sendWithEnter = useSettings((s) => s.sendWithEnter)
  const overrides = useModelConfig((s) => s.overrides)
  const generation = useSettings((s) => s.generation)
  const setPresetChoice = useSettings((s) => s.setPresetChoice)

  const options = chatOptionsFor(getCatalogModel(modelId), overrides)
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
    const targetChatId = sendMessage(chatId, text, modelId, attachments.map((attachment) => attachment.id), temporary)
    if (!chatId && targetChatId) navigate(`/c/${targetChatId}`)
    setValue('')
    setAttachments([])
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto'
    })
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const created = await apiRequest<{ attachment: { id: string }; uploadUrl: string; uploadHeaders: Record<string, string> }>('/api/attachments', {
          method: 'POST',
          body: { chatId, originalName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
        })
        const upload = await fetch(created.uploadUrl, {
          method: 'PUT', body: file, headers: created.uploadHeaders,
          credentials: created.uploadUrl.startsWith('/api/') ? 'include' : 'omit',
        })
        if (!upload.ok) throw new Error(`Upload failed (${upload.status})`)
        await apiRequest(`/api/attachments/${created.attachment.id}/confirm`, { method: 'POST' })
        setAttachments((current) => [...current, { id: created.attachment.id, name: file.name, size: file.size }])
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className={cn('w-full', centered && 'px-2')}>
      <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:shadow-md">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
                <Paperclip className="size-3" />
                <span className="max-w-40 truncate">{attachment.name}</span>
                <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}>
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
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
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Attach files"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4.5" />}
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
              disabled={!value.trim() || uploading}
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
