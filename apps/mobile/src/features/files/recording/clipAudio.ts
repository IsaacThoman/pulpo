import type { RecordingClipAudio } from '@pulpo/client-core/files'
import type { RecordingClip } from '@pulpo/contracts'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import { downloadRecordingClip } from '../api'

/** How often the player reports its position; the shared playback reads it about as often. */
const UPDATE_INTERVAL_MS = 100
const LOAD_TIMEOUT_MS = 15_000

export const TAKE_UNPLAYABLE = 'This take can’t be played on this device.'

function whenLoaded(player: AudioPlayer, signal: AbortSignal): Promise<void> {
  if (player.isLoaded) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      subscription.remove()
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new Error('Cancelled'))
    const timer = setTimeout(() => finish(new Error('The take took too long to load.')), LOAD_TIMEOUT_MS)
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.playbackState === 'error') finish(new Error(TAKE_UNPLAYABLE))
      else if (status.isLoaded) finish()
    })
    signal.addEventListener('abort', abort, { once: true })
    // It may have loaded between the check and subscribing.
    if (player.isLoaded) finish()
  })
}

/**
 * One take's audio for the shared recording playback: downloaded once (takes never change),
 * then played by a native player with pitch kept at any speed.
 */
export async function loadClipAudio(recordingId: string, clip: Pick<RecordingClip, 'id' | 'mimeType' | 'sizeBytes'>, signal: AbortSignal): Promise<RecordingClipAudio> {
  const file = await downloadRecordingClip(recordingId, clip)
  if (signal.aborted) throw new Error('Cancelled')
  await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false })
  const player = createAudioPlayer(file.uri, { updateInterval: UPDATE_INTERVAL_MS })
  let finished = false
  const subscription = player.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish) finished = true
  })
  try {
    await whenLoaded(player, signal)
  } catch (error) {
    subscription.remove()
    player.remove()
    throw error
  }
  player.shouldCorrectPitch = true
  return {
    play: () => {
      finished = false
      player.play()
    },
    pause: () => player.pause(),
    seek: async (seconds) => {
      finished = false
      await player.seekTo(seconds)
    },
    currentTime: () => player.currentTime,
    ended: () => finished,
    setRate: (rate) => player.setPlaybackRate(rate, 'high'),
    dispose: () => {
      subscription.remove()
      player.remove()
    },
  }
}
