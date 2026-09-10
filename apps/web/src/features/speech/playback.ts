import { speechChunks, speechText } from '@pulpo/client-core'
import { SPEECH_DURATION_HEADER, type PublicSpeechModel } from '@pulpo/contracts'
import { apiRequest, fetchApiBlob, fetchApiBlobResponse } from '@/lib/api'
import { useSettings } from '@/stores/settings'
import { useAuth } from '@/stores/auth'
import { useChat } from '@/stores/chat'

import { speechPlayback } from './state'
export { speechPlayback } from './state'
export const speechCatalog = () => apiRequest<{ data: PublicSpeechModel[] }>('/api/speech-models')
export async function readAloud(key: string, markdown: string) {
  if (speechPlayback.getSnapshot().key === key) { speechPlayback.stop(); return }
  let model: PublicSpeechModel
  let settings: { voice?: string; instructions: string; speed: number } | undefined
  let instructions = ''
  await speechPlayback.start(key, async signal => {
    const preferences = useSettings.getState().speech
    if (!preferences.modelId) throw new Error('Choose a speech model in Settings → Interface → Speech')
    const { data } = await apiRequest<{ data: PublicSpeechModel[] }>('/api/speech-models', { signal })
    const selected = data.find(model => model.id === preferences.modelId)
    if (!selected) throw new Error('Your speech model is unavailable. Choose another in Settings → Interface → Speech')
    model = selected; settings = preferences.models[model.id]
    instructions = model.supportsInstructions ? settings?.instructions ?? '' : ''
    const chunks = speechChunks(speechText(markdown), model, instructions)
    if (!chunks.length) throw new Error('This message has no readable text')
    return chunks
  }, async (input, signal, offsetSeconds) => {
    const response = await fetchApiBlobResponse('/api/speech', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      requestId: crypto.randomUUID(), modelId: model.id, input, playbackOffsetSeconds: offsetSeconds, voice: settings?.voice ?? model.defaultVoice,
      ...(model.supportsInstructions ? { instructions } : {}), ...(model.supportsSpeed ? { speed: settings?.speed ?? 1 } : {}),
    }) })
    return { ...browserSpeechAudio(await response.blob()), durationSeconds: Number(response.headers.get(SPEECH_DURATION_HEADER)) }
  })
}
document.addEventListener('visibilitychange', () => { if (document.hidden) speechPlayback.stop() })
useAuth.subscribe((state, previous) => { if (state.user?.id !== previous.user?.id) speechPlayback.stop() })
useChat.subscribe((state, previous) => { if (state.activeChatId !== previous.activeChatId) speechPlayback.stop() })

export function previewSpeechVoice(modelId: string, voiceId: string) {
  return speechPlayback.start(`preview:${modelId}:${voiceId}`, ['preview'], async (_, signal) => {
    if (document.hidden) throw new Error('Open the app to preview speech')
    return browserSpeechAudio(await fetchApiBlob(`/api/speech-models/${encodeURIComponent(modelId)}/voices/${encodeURIComponent(voiceId)}/preview`, { signal }))
  })
}
export function previewSpeechFile(file: File, key = 'preview:upload') {
  return speechPlayback.start(key, ['preview'], async () => {
    if (document.hidden) throw new Error('Open the app to preview speech')
    return browserSpeechAudio(file)
  })
}
export function browserSpeechAudio(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  return {
    dispose: () => { audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url) },
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
