import { useEffect, useRef, useState } from 'react'
import { AudioLines, Loader2 } from 'lucide-react'
import { audioTranscriptionMimeType, MAX_AUDIO_TRANSCRIPTION_BYTES } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { CopyTextButton } from '@/components/chat/CopyTextButton'
import { apiRequest } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ui, uit } from '@/i18n/ui'
import { useAuth } from '@/stores/auth'

export function AudioFilePreview({ name, mimeType, size, url, loadAudio, className }: {
  name: string
  mimeType: string | null
  size: number
  url: string
  loadAudio: (signal: AbortSignal) => Promise<Blob>
  className?: string
}) {
  const enabled = useAuth((state) => state.dictationEnabled)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  const type = audioTranscriptionMimeType(mimeType)
  const unavailable = !enabled ? ui("Audio transcription is unavailable on this instance.")
    : !type ? ui("This audio format is not supported for transcription.")
    : size > MAX_AUDIO_TRANSCRIPTION_BYTES ? ui("Audio must be 10 MiB or smaller to transcribe.") : null

  async function transcribe() {
    if (unavailable || !type || request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError('')
    try {
      const blob = await loadAudio(controller.signal)
      if (controller.signal.aborted) return
      if (blob.size > MAX_AUDIO_TRANSCRIPTION_BYTES) throw new Error(ui("Audio must be 10 MiB or smaller to transcribe."))
      if (!blob.size) throw new Error(ui("This audio file is empty."))
      const form = new FormData()
      form.append('file', new File([blob], name, { type }))
      const result = await apiRequest<{ text: string }>('/api/dictation/transcriptions', {
        method: 'POST', body: form, signal: controller.signal,
      })
      if (!controller.signal.aborted) setText(result.text)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : ui("Unable to transcribe audio."))
    } finally {
      request.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <div data-preview-kind="audio" className={cn('overflow-auto bg-gradient-to-br from-fuchsia-500/10 via-background to-violet-500/10 p-4 sm:p-8', className)}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="space-y-3 rounded-xl border bg-background p-4">
          <audio src={url} controls preload="metadata" aria-label={uit`Audio preview of ${name}`}
            className="block w-full" onError={() => setPlaybackFailed(true)} />
          {playbackFailed && <p role="alert" className="text-sm text-destructive">{ui("This audio could not be played.")}</p>}
          {text === null && (
            <Button type="button" variant="outline" disabled={Boolean(unavailable) || pending} aria-busy={pending} onClick={() => void transcribe()}>
              {pending ? <Loader2 className="animate-spin" /> : <AudioLines />}
              {pending ? ui("Transcribing…") : ui("Transcribe")}
            </Button>
          )}
          <span role="status" className="sr-only">{text !== null ? ui("Transcript ready.") : pending ? ui("Transcribing…") : ''}</span>
          {unavailable && text === null && <p className="text-sm text-muted-foreground">{unavailable}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        {text !== null && (
          <section aria-label={ui("Transcript")} className="rounded-xl border bg-background p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{ui("Transcript")}</h2>
              <CopyTextButton text={text} />
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{text}</p>
          </section>
        )}
      </div>
    </div>
  )
}
