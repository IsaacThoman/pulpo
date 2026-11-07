import { NativeModule, requireOptionalNativeModule } from 'expo'

declare class PulpoFileClipboardModule extends NativeModule {
  copyFile(uri: string): Promise<void>
  /** Absent from binaries built before saving was added. */
  saveImageToPhotos?(uri: string): Promise<void>
  /** Resolves `true` once saved, `false` when the user cancelled. Absent from older binaries. */
  exportFile?(uri: string, name: string): Promise<boolean>
  /** Re-reports hosted SwiftUI controls' accessibility frames after a transform moved them. Absent from older binaries. */
  refreshAccessibilityFrames?(): void
}

export default requireOptionalNativeModule<PulpoFileClipboardModule>('PulpoFileClipboard')
