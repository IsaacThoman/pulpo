import { useEffect, useState, useSyncExternalStore } from 'react'
import { Loader2, Square, Volume2 } from 'lucide-react'
import { speechText } from '@pulpo/client-core'
import { readAloud, speechPlayback } from './playback'
import { ui } from '@/i18n/ui'
import { ActionButton } from '@/components/chat/ActionButton'

export function SpeechButton({ messageKey, text }: { messageKey: string; text: string }) {
  const state = useSyncExternalStore(speechPlayback.subscribe, speechPlayback.getSnapshot, speechPlayback.getSnapshot)
  const [error, setError] = useState<string | null>(null)
  const active = state.key === messageKey
  useEffect(() => () => { if (speechPlayback.getSnapshot().key === messageKey) speechPlayback.stop() }, [messageKey, text])
  if (!speechText(text)) return null
  const label = active ? 'Stop reading' : 'Read aloud'
  return <><ActionButton label={ui(label)} aria-pressed={active} active={active} onClick={() => { setError(null); void readAloud(messageKey, text).then(() => setError(speechPlayback.getSnapshot().error)).catch(error => setError(error.message)) }}>
    {active ? state.phase === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
  </ActionButton>{error && <span role="alert" className="text-xs text-destructive">{ui(error)}</span>}</>
}
