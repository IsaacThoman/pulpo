import { useEffect, useState, useSyncExternalStore } from 'react'
import { RecordingPlayback, type RecordingClipAudio, type RecordingTimeline } from '@pulpo/client-core/files'
import { filesErrorMessage } from '@/features/files/file-display'
import { ui } from '@/i18n/ui'
import { fetchRecordingClipBlob } from './api'

/** Waits for an audio element to know its length, or to fail. */
function loaded(element: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve() }
    const failed = () => { cleanup(); reject(new Error(ui("This take can't be played in this browser"))) }
    const aborted = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => {
      element.removeEventListener('loadedmetadata', done)
      element.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
    }
    element.addEventListener('loadedmetadata', done, { once: true })
    element.addEventListener('error', failed, { once: true })
    signal.addEventListener('abort', aborted, { once: true })
  })
}

/** A take's audio in an audio element, from a local copy so seeking never waits on the network. */
export async function webClipAudio(audio: Blob, signal: AbortSignal): Promise<RecordingClipAudio> {
  const url = URL.createObjectURL(audio)
  const element = new Audio()
  element.preload = 'auto'
  element.preservesPitch = true
  element.src = url
  try {
    await loaded(element, signal)
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return {
    play: () => element.play(),
    pause: () => element.pause(),
    seek: (seconds) => { element.currentTime = seconds },
    currentTime: () => element.currentTime,
    ended: () => element.ended,
    setRate: (rate) => { element.playbackRate = rate },
    dispose: () => {
      element.pause()
      element.removeAttribute('src')
      element.load()
      URL.revokeObjectURL(url)
    },
  }
}

/** Plays a recording's takes as one; the controller follows the recording as it changes. */
export function useRecordingPlayback(recordingId: string, timeline: RecordingTimeline) {
  const [playback] = useState(() => new RecordingPlayback({
    load: async (clip, signal) => webClipAudio(await fetchRecordingClipBlob(recordingId, clip.id, signal), signal),
    errorMessage: (error) => filesErrorMessage(error),
  }))
  useEffect(() => playback.setTimeline(timeline), [playback, timeline])
  useEffect(() => () => playback.dispose(), [playback])
  const state = useSyncExternalStore(playback.subscribe, playback.getSnapshot)
  return { playback, state }
}
