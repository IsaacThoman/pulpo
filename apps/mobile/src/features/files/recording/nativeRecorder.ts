import { RECORDING_AUDIO_BITS_PER_SECOND } from '@pulpo/contracts'
import { AudioModule, IOSOutputFormat, AudioQuality, setAudioModeAsync, type RecordingOptions } from 'expo-audio'
import { File } from 'expo-file-system'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { AppState } from 'react-native'
import { TakeRecorderController } from './recorder'

const KEEP_AWAKE_TAG = 'pulpo-voice-recording'

/** Speech in mono AAC at the bit rate the server keeps, so takes upload quickly and convert cleanly. */
export const TAKE_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44_100,
  numberOfChannels: 1,
  bitRate: RECORDING_AUDIO_BITS_PER_SECOND,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  web: { mimeType: 'audio/webm', bitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND },
}

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

export function createNativeTakeRecorder(): TakeRecorderController {
  return new TakeRecorderController({
    permission: requestMicrophonePermission,
    isForeground: () => AppState.currentState === 'active',
    audioMode: (allowsRecording) => setAudioModeAsync({ allowsRecording, playsInSilentMode: true, shouldPlayInBackground: false }),
    recorder: () => {
      const recorder = new AudioModule.AudioRecorder(TAKE_RECORDING_OPTIONS)
      return {
        prepare: () => recorder.prepareToRecordAsync(),
        record: () => recorder.record(),
        pause: () => recorder.pause(),
        stop: () => recorder.stop(),
        release: () => recorder.release(),
        get uri() { return recorder.uri },
        status: () => {
          const status = recorder.getStatus()
          return { isRecording: status.isRecording, durationMillis: status.durationMillis, metering: status.metering }
        },
      }
    },
    remove: (uri) => {
      const file = new File(uri)
      if (file.exists) file.delete()
    },
    // The screen stays on while recording: the app can't record once it's in the background.
    keepAwake: (awake) => {
      if (awake) void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined)
      else void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined)
    },
  })
}
