import { useRef, useSyncExternalStore } from 'react'
import { Loader2, Play, Square, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { previewSpeechFile, previewSpeechVoice, speechPlayback } from '@/features/speech/playback'
import { ui } from '@/i18n/ui'

export function SpeechVoicePreview({ modelId, voiceId, label, available, change, disabled, onChange, onError }: {
  modelId: string; voiceId: string; label: string; available: boolean; change: File | null | undefined
  disabled: boolean; onChange: (file: File | null) => void; onError: (error: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const playback = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  const key = `preview:${modelId}:${voiceId}`
  const active = playback.key === key
  const hasClip = Boolean(change || (available && change !== null))
  return <div className="space-y-1">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={ui('Upload preview for {{name}}', { name: label })} onClick={() => input.current?.click()}><Upload className="size-3.5" />{ui(hasClip ? 'Replace preview' : 'Upload preview clip')}</Button>
      <input ref={input} className="hidden" type="file" aria-label={ui('Preview file for {{name}}', { name: label })} accept="audio/mpeg,audio/wav,.mp3,.wav" disabled={disabled} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (!file) return
        if (file.size > 5 * 1024 * 1024) { onError(ui('Preview clips may be at most 5 MiB')); return }
        speechPlayback.stop(); onChange(file); onError('')
      }} />
      {hasClip && <>
        <Button type="button" variant="outline" size="icon" className="size-8 rounded-full" disabled={disabled} aria-label={active ? ui('Stop preview') : ui('Preview {{name}}', { name: label })} onClick={() => {
          if (active) speechPlayback.stop()
          else if (change) void previewSpeechFile(change, key)
          else void previewSpeechVoice(modelId, voiceId)
        }}>{active ? playback.phase === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" /> : <Play className="size-3.5" />}</Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled} aria-label={ui('Remove preview for {{name}}', { name: label })} onClick={() => { speechPlayback.stop(); onChange(null) }}><Trash2 className="size-3.5" /></Button>
        {change && <span className="min-w-0 break-all text-xs text-muted-foreground">{change.name}</span>}
      </>}
    </div>
    {change === null && available && <p className="text-xs text-muted-foreground">{ui('The preview will be removed when you save.')}</p>}
  </div>
}
