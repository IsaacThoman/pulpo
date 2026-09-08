import { speechPlayback } from '../speech/state'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppState, Platform } from 'react-native'
import { AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio'
import { File } from 'expo-file-system'
import { insertDictationText } from '@pulpo/client-core'
import { apiRequest } from '../../api/client'
import { DictationController } from './dictation'

async function requestMicrophonePermission(): Promise<boolean> {
  const current = await AudioModule.getRecordingPermissionsAsync()
  const permission = current.granted ? current : await AudioModule.requestRecordingPermissionsAsync()
  if (!permission.granted) return false
  // Android permission activities can resolve before React Native receives onResume.
  // Never open the microphone until the app is back in the foreground.
  if (AppState.currentState !== 'active') {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        subscription.remove()
        reject(new Error('Recording was interrupted. Please try again.'))
      }, 1000)
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') { clearTimeout(timer); subscription.remove(); resolve() }
      })
    })
  }
  return true
}

export function createNativeDictation(): DictationController {
  return new DictationController({
    permission: requestMicrophonePermission,
    isForeground: () => AppState.currentState === 'active',
    audioMode: (allowsRecording) => setAudioModeAsync({ allowsRecording, playsInSilentMode: true, shouldPlayInBackground: false }),
    recorder: () => {
      const preset = RecordingPresets.HIGH_QUALITY
      const recorder = new AudioModule.AudioRecorder({ ...preset, ...preset[Platform.OS === 'ios' ? 'ios' : 'android'] })
      return {
        prepare: () => recorder.prepareToRecordAsync(),
        record: () => recorder.record(),
        stop: () => recorder.stop(),
        release: () => recorder.release(),
        get uri() { return recorder.uri },
        get isRecording() { return recorder.isRecording },
      }
    },
    size: (uri) => new File(uri).size,
    remove: (uri) => { const file = new File(uri); if (file.exists) file.delete() },
    transcribe: async (uri, signal) => {
      const form = new FormData()
      // SDK 57 uses standards-based fetch; URI descriptors are not multipart Blobs.
      const audio = new File(uri)
      Object.defineProperties(audio, { type: { value: 'audio/mp4' }, name: { value: 'dictation.m4a' } })
      form.append('file', audio, 'dictation.m4a')
      const result = await apiRequest<{ text: string }>('/api/dictation/transcriptions', {
        method: 'POST', body: form, signal, timeoutMs: 45_000,
      })
      return result.text
    },
  })
}

export function useDictation(input: {
  identity: string
  enabled: boolean
  canStart: boolean
  read: () => { text: string; selection: { start: number; end: number } }
  apply: (value: string, cursor: number) => void
}, create = createNativeDictation) {
  const [controller] = useState(create)
  const latest = useRef(input)
  latest.current = input
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useLayoutEffect(() => {
    if (!input.enabled) controller.cancel()
    return controller.cancel
  }, [controller, input.identity, input.enabled])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      // Permission dialogs pause the activity on Android and inactivate iOS.
      if (next !== 'active' && !controller.requestingPermission) controller.cancel()
    })
    return () => { subscription.remove(); controller.cancel() }
  }, [controller])
  const isBusy = useCallback(() => controller.busy, [controller])
  const start = () => {
    speechPlayback.stop()
    if (!latest.current.enabled || !latest.current.canStart || controller.busy) return
    const original = latest.current.read()
    const identity = latest.current.identity
    void controller.start((text) => {
      if (latest.current.identity !== identity || !latest.current.enabled) return
      const current = latest.current.read()
      const selection = current.text === original.text ? original.selection : { start: current.text.length, end: current.text.length }
      const inserted = insertDictationText(current.text, text, selection.start, selection.end)
      latest.current.apply(inserted.value, inserted.cursor)
    })
  }
  return { ...state, busy: state.phase !== 'idle', isBusy, start, stop: controller.stop, cancel: controller.cancel }
}
