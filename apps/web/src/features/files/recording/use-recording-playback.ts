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

/**
 * A take's audio, from a local copy so seeking never waits on the network. Every take plays in
 * the same audio element, swapping its source: Safari only lets an element play without a click
 * once a click has started it, so a new element per take would stop at the second take.
 */
export function webClipAudio(audio: Blob, element: HTMLAudioElement, signal: AbortSignal): RecordingClipAudio {
  const url = URL.createObjectURL(audio)
  const active = () => element.src === url
  const activate = async () => {
    if (active()) return
    element.src = url
    await loaded(element, signal)
  }
  return {
    play: async () => {
      await activate()
      await element.play()
    },
    pause: () => { if (active()) element.pause() },
    seek: async (seconds) => {
      await activate()
      element.currentTime = seconds
    },
    currentTime: () => active() ? element.currentTime : 0,
    ended: () => active() && element.ended,
    setRate: (rate) => {
      // Loading another take resets the rate to the default one, so that changes too.
      element.defaultPlaybackRate = rate
      element.playbackRate = rate
    },
    dispose: () => {
      if (active()) {
        element.pause()
        element.removeAttribute('src')
        element.load()
      }
      URL.revokeObjectURL(url)
    },
  }
}

/** Plays a recording's takes as one; the controller follows the recording as it changes. */
export function useRecordingPlayback(recordingId: string, timeline: RecordingTimeline) {
  const [playback] = useState(() => {
    const element = new Audio()
    element.preload = 'auto'
    element.preservesPitch = true
    return new RecordingPlayback({
      load: async (clip, signal) => webClipAudio(await fetchRecordingClipBlob(recordingId, clip.id, signal), element, signal),
      errorMessage: (error) => filesErrorMessage(error),
    })
  })
  useEffect(() => playback.setTimeline(timeline), [playback, timeline])
  useEffect(() => () => playback.dispose(), [playback])
  const state = useSyncExternalStore(playback.subscribe, playback.getSnapshot)
  return { playback, state }
}
