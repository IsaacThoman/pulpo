import { NativeModule, requireOptionalNativeModule } from 'expo'

declare class PulpoFileClipboardModule extends NativeModule {
  copyFile(uri: string): Promise<void>
}

export default requireOptionalNativeModule<PulpoFileClipboardModule>('PulpoFileClipboard')
