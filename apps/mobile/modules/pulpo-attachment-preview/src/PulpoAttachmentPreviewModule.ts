import { NativeModule, requireOptionalNativeModule } from 'expo'

declare class PulpoAttachmentPreviewModule extends NativeModule {
  previewFile(uri: string, title: string): Promise<void>
}

export default requireOptionalNativeModule<PulpoAttachmentPreviewModule>('PulpoAttachmentPreview')
