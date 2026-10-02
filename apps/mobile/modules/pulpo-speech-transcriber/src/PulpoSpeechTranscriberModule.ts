import { NativeModule, requireOptionalNativeModule } from 'expo'

declare class PulpoSpeechTranscriberModule extends NativeModule {
  /** Whether this device can run Apple's on-device speech transcriber. */
  isAvailable(): boolean
  /** Resolves the supported locale for `language`, downloading its model if needed. */
  prepare(language: string): Promise<string>
  /** Transcribes a local audio file with a locale returned by `prepare`. */
  transcribe(uri: string, language: string): Promise<string>
}

export default requireOptionalNativeModule<PulpoSpeechTranscriberModule>('PulpoSpeechTranscriber')
