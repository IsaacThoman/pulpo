import { NativeModule, requireOptionalNativeModule } from 'expo'

declare class PulpoAudioFocusModule extends NativeModule {
  /** Asks other apps to pause their audio until `release`. Resolves whether focus was granted. */
  acquire(): Promise<boolean>
  /** Gives audio focus back so paused apps can resume. */
  release(): Promise<void>
}

/** Null on iOS, where the audio session handles this, and in Android binaries built before it. */
export default requireOptionalNativeModule<PulpoAudioFocusModule>('PulpoAudioFocus')
