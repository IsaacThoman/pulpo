import { AppState } from 'react-native'
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { File, Paths, Directory } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { speechChunks, speechText } from '@pulpo/client-core'
import type { PublicSpeechModel } from '@pulpo/contracts'
import { apiRequest, apiUrl, nativeAuthorizationHeaders } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'

import { speechPlayback } from './state'
export { speechPlayback } from './state'
const directory = new Directory(Paths.cache, 'speech')
// Clear files left behind if the OS killed the preceding playback session.
if (directory.exists) directory.delete()
directory.create({ intermediates: true, idempotent: true })
export async function readAloud(key: string, markdown: string) {
  let model: PublicSpeechModel
  let settings: { voice?: string; instructions: string; speed: number } | undefined
  let instructions = ''
  await speechPlayback.start(key, async signal => {
    if (AppState.currentState !== 'active') throw new Error('Open the app to read aloud')
    const preferences = usePreferencesStore.getState().speech
    if (!preferences.modelId) throw new Error('Choose a speech model in Settings → Interface → Speech')
    const { data } = await apiRequest<{ data: PublicSpeechModel[] }>('/api/speech-models', { signal })
    const selected = data.find(model => model.id === preferences.modelId)
    if (!selected) throw new Error('Your speech model is unavailable. Choose another in Settings → Interface → Speech')
    model = selected; settings = preferences.models[model.id]
    instructions = model.supportsInstructions ? settings?.instructions ?? '' : ''
    const chunks = speechChunks(speechText(markdown), model, instructions)
    if (!chunks.length) throw new Error('This message has no readable text')
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false })
    return chunks
  }, async (input, signal) => {
    const response = await fetch(apiUrl('/api/speech'), { method: 'POST', signal, headers: { ...nativeAuthorizationHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({
      requestId: randomUUID(), modelId: model.id, input, voice: settings?.voice ?? model.defaultVoice,
      ...(model.supportsInstructions ? { instructions } : {}), ...(model.supportsSpeed ? { speed: settings?.speed ?? 1 } : {}),
    }) })
    if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? 'Speech generation failed') }
    const bytes = new Uint8Array(await response.arrayBuffer())
    return nativeSpeechAudio(bytes, model.responseFormat, signal)
  })
}
AppState.addEventListener('change', state => { if (state !== 'active') speechPlayback.stop() })
useSessionStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.instanceUrl !== previous.instanceUrl || state.token !== previous.token) speechPlayback.stop()
})

export function previewSpeechVoice(modelId: string, voiceId: string) {
  return speechPlayback.start(`preview:${modelId}:${voiceId}`, ['preview'], async (_, signal) => {
    if (AppState.currentState !== 'active') throw new Error('Open the app to preview speech')
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false })
    const response = await fetch(apiUrl(`/api/speech-models/${encodeURIComponent(modelId)}/voices/${encodeURIComponent(voiceId)}/preview`), { signal, headers: nativeAuthorizationHeaders() })
    if (!response.ok) throw new Error('This preview is unavailable')
    const bytes = new Uint8Array(await response.arrayBuffer())
    return nativeSpeechAudio(bytes, response.headers.get('content-type')?.includes('wav') ? 'wav' : 'mp3', signal)
  })
}
function nativeSpeechAudio(bytes: Uint8Array, format: string, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Cancelled')
  const file = new File(directory, `${randomUUID()}.${format}`)
  file.write(bytes)
  let player: ReturnType<typeof createAudioPlayer>
  try { player = createAudioPlayer(file.uri) } catch (error) { file.delete(); throw error }
  let disposed = false
  return {
    dispose: () => { if (disposed) return; disposed = true; player.remove(); if (file.exists) file.delete() },
    play: (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
      const subscription = player.addListener('playbackStatusUpdate', status => {
        if (status.didJustFinish) { cleanup(); resolve() }
        else if (status.playbackState === 'error') { cleanup(); reject(new Error('Unable to play speech audio')) }
      })
      const cleanup = () => { subscription.remove(); signal.removeEventListener('abort', abort) }
      const abort = () => { player.pause(); cleanup(); resolve() }
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      try { player.play() } catch (error) { cleanup(); reject(error) }
    }),
  }
}
