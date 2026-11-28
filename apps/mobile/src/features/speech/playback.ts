import { AppState } from 'react-native'
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioMetadata } from 'expo-audio'
import { File, Paths, Directory } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { speechChunks, speechText, speechTitle } from '@pulpo/client-core'
import { SPEECH_DEFAULT_PREVIEW_TEXT, SPEECH_DURATION_HEADER, type PublicSpeechModel, type SpeechCatalog } from '@pulpo/contracts'
import { apiRequest, apiUrl, nativeAuthorizationHeaders } from '../../api/client'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'

import { speechPlayback } from './state'
export { speechPlayback } from './state'
const directory = new Directory(Paths.cache, 'speech')
// Clear files left behind if the OS killed the preceding playback session.
if (directory.exists) directory.delete()
directory.create({ intermediates: true, idempotent: true })
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
  const current = usePreferencesStore.getState().speech
  const preferences = { ...current, models: Object.fromEntries(Object.entries(current.models).map(([id, settings]) => [id, { ...settings }])) }
  let model: PublicSpeechModel
  let settings: { voice?: string; instructions: string; speed: number } | undefined
  let instructions = ''
  let metadata: AudioMetadata = {}
  await speechPlayback.start(key, async signal => {
    if (AppState.currentState !== 'active') throw new Error('Open the app to read aloud')
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
    metadata = { title: markdown === undefined ? 'Voice preview' : speechTitle(text), artist: 'Pulpo' }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true })
    // Dictation hands audio back to other apps by deactivating it; reading aloud takes it again.
    await setIsAudioActiveAsync(true)
    return chunks
  }, async (input, signal, offsetSeconds) => {
    const response = await fetch(apiUrl('/api/speech'), { method: 'POST', signal, headers: { ...nativeAuthorizationHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({
      requestId: randomUUID(), modelId: model.id, input, playbackOffsetSeconds: offsetSeconds, voice: settings?.voice ?? model.defaultVoice,
      ...(model.supportsInstructions ? { instructions } : {}), ...(model.supportsSpeed ? { speed: settings?.speed ?? 1 } : {}),
    }) })
    if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? 'Speech generation failed') }
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { ...nativeSpeechAudio(bytes, model.responseFormat, signal, metadata), durationSeconds: Number(response.headers.get(SPEECH_DURATION_HEADER)), format: model.responseFormat, bytes: () => bytes }
  }, { retain: markdown !== undefined })
}
useSessionStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.instanceUrl !== previous.instanceUrl || state.token !== previous.token) speechPlayback.stop()
})

function nativeSpeechAudio(bytes: Uint8Array, format: string, signal: AbortSignal, metadata: AudioMetadata) {
  if (signal.aborted) throw new Error('Cancelled')
  const file = new File(directory, `${randomUUID()}.${format}`)
  file.write(bytes)
  let player: ReturnType<typeof createAudioPlayer>
  try { player = createAudioPlayer(file.uri) } catch (error) { file.delete(); throw error }
  let disposed = false
  // Whether reading aloud wants this chunk playing, to tell apart pauses made outside the app.
  let wanted = false
  let settle: ((error?: Error) => void) | undefined
  let check: ReturnType<typeof setTimeout> | undefined
  const subscription = player.addListener('playbackStatusUpdate', status => {
    if (status.didJustFinish) { wanted = false; settle?.(); return }
    if (status.playbackState === 'error') { settle?.(new Error('Unable to play speech audio')); return }
    // Lock-screen controls, headphones, and interruptions such as calls play or pause the player directly.
    if (status.playing && !wanted && settle) { wanted = true; speechPlayback.resume() }
    // A finished reading still shows on the lock screen; playing it there replays the whole message, not just this chunk.
    else if (status.playing && !wanted && !disposed && speechPlayback.getSnapshot().phase === 'ended') { player.pause(); speechPlayback.resume() }
    else if (!status.playing && wanted) {
      // The player also stops briefly while seeking and just before it finishes, so only a lasting stop counts.
      clearTimeout(check)
      check = setTimeout(() => { if (wanted && !disposed && !player.playing) speechPlayback.pause() }, 500)
    }
  })
  return {
    dispose: () => { if (disposed) return; disposed = true; clearTimeout(check); subscription.remove(); player.clearLockScreenControls(); player.remove(); if (file.exists) file.delete() },
    pause: () => { wanted = false; player.pause() },
    resume: () => { wanted = true; player.play() },
    seek: (seconds: number) => player.seekTo(seconds),
    currentTime: () => player.currentTime,
    duration: () => player.duration,
    setRate: (rate: number) => { player.shouldCorrectPitch = true; player.setPlaybackRate(rate, 'high') },
    play: (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => { settle = undefined; wanted = false; signal.removeEventListener('abort', abort); if (error) reject(error); else resolve() }
      const abort = () => { player.pause(); done() }
      if (signal.aborted) { abort(); return }
      signal.addEventListener('abort', abort, { once: true })
      settle = done; wanted = true
      try {
        // Shows the reading on the lock screen, which also keeps it playing while the app is in the background.
        player.setActiveForLockScreen(true, metadata)
        player.play()
      } catch (error) { done(error instanceof Error ? error : new Error('Unable to play speech audio')) }
    }),
  }
}
