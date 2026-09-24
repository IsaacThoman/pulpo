import { SPEECH_SEEK_SECONDS, speechChunks, speechText } from '@pulpo/client-core'
import { SPEECH_DEFAULT_PREVIEW_TEXT, SPEECH_DURATION_HEADER, type PublicSpeechModel, type SpeechCatalog } from '@pulpo/contracts'
import { apiRequest, fetchApiBlobResponse } from '@/lib/api'
import { useSettings } from '@/stores/settings'
import { useAuth } from '@/stores/auth'
import { useChat } from '@/stores/chat'

import { speechPlayback } from './state'
export { speechPlayback } from './state'
export const speechCatalog = () => apiRequest<SpeechCatalog>('/api/speech-models')
export function readAloud(key: string, markdown: string) {
  return playSpeech(key, markdown)
}
export function previewSpeech() {
  return playSpeech('preview:settings')
}
async function playSpeech(key: string, markdown?: string) {
  const snapshot = speechPlayback.getSnapshot()
  // A finished message keeps its audio, so reading it again replays without regenerating.
  if (snapshot.key === key) { if (snapshot.phase === 'ended') speechPlayback.replay(); else speechPlayback.stop(); return }
  const current = useSettings.getState().speech
  const preferences = { ...current, models: Object.fromEntries(Object.entries(current.models).map(([id, settings]) => [id, { ...settings }])) }
  let model: PublicSpeechModel
  let settings: { voice?: string; instructions: string; speed: number } | undefined
  let instructions = ''
  await speechPlayback.start(key, async signal => {
    if (document.hidden) throw new Error('Open the app to play speech')
    const { data, defaultModelId } = await apiRequest<SpeechCatalog>('/api/speech-models', { signal })
    const modelId = preferences.modelId ?? defaultModelId
    if (!modelId) throw new Error('Choose a speech model in Settings → Personalization → Speech')
    const selected = data.find(model => model.id === modelId)
    if (!selected) throw new Error('Your speech model is unavailable. Choose another in Settings → Personalization → Speech')
    model = selected; settings = preferences.models[model.id]
    instructions = model.supportsInstructions ? settings?.instructions ?? '' : ''
    const voice = model.voices.find(voice => voice.id === (settings?.voice ?? model.defaultVoice))
    if (markdown === undefined && !voice) throw new Error('Your speech voice is unavailable. Choose another in Settings → Personalization → Speech')
    const text = markdown === undefined ? voice?.previewText ?? SPEECH_DEFAULT_PREVIEW_TEXT : speechText(markdown)
    const chunks = speechChunks(text, model, instructions)
    if (!chunks.length) throw new Error('This message has no readable text')
    return chunks
  }, async (input, signal, offsetSeconds) => {
    const response = await fetchApiBlobResponse('/api/speech', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      requestId: crypto.randomUUID(), modelId: model.id, input, playbackOffsetSeconds: offsetSeconds, voice: settings?.voice ?? model.defaultVoice,
      ...(model.supportsInstructions ? { instructions } : {}), ...(model.supportsSpeed ? { speed: settings?.speed ?? 1 } : {}),
    }) })
    return { ...browserSpeechAudio(await response.blob()), durationSeconds: Number(response.headers.get(SPEECH_DURATION_HEADER)) }
  }, { retain: markdown !== undefined })
}
document.addEventListener('visibilitychange', () => { if (document.hidden) speechPlayback.stop() })
useAuth.subscribe((state, previous) => { if (state.user?.id !== previous.user?.id) speechPlayback.stop() })
useChat.subscribe((state, previous) => { if (state.activeChatId !== previous.activeChatId) speechPlayback.stop() })
// Hardware media keys and the browser's media controls drive message playback.
if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
  const handlers: Array<[MediaSessionAction, () => void]> = [
    ['play', speechPlayback.resume], ['pause', speechPlayback.pause], ['stop', speechPlayback.stop],
    ['seekbackward', () => speechPlayback.seekBy(-SPEECH_SEEK_SECONDS)], ['seekforward', () => speechPlayback.seekBy(SPEECH_SEEK_SECONDS)],
  ]
  for (const [action, handler] of handlers) {
    try { navigator.mediaSession.setActionHandler(action, handler) } catch { /* Unsupported action. */ }
  }
}

export function browserSpeechAudio(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  return {
    dispose: () => { audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url) },
    pause: () => audio.pause(),
    resume: () => { void audio.play().catch(() => {}) },
    seek: (seconds: number) => { audio.currentTime = seconds },
    currentTime: () => audio.currentTime,
    duration: () => audio.duration,
    setRate: (rate: number) => { audio.defaultPlaybackRate = rate; audio.playbackRate = rate },
    play: (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener('abort', abort); audio.onended = null; audio.onerror = null }
      const abort = () => { audio.pause(); cleanup(); resolve() }
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      audio.onended = () => { cleanup(); resolve() }
      audio.onerror = () => { cleanup(); reject(new Error('Unable to play speech audio')) }
      void audio.play().catch(() => { cleanup(); reject(new Error('Playback was blocked. Select Read aloud to try again.')) })
    }),
  }
}
