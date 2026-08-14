import { NativeModule, requireOptionalNativeModule } from 'expo'

export interface PulpoImageTransitionFrame {
  x: number
  y: number
  width: number
  height: number
  cornerRadius: number
}

declare class PulpoAttachmentPreviewModule extends NativeModule {
  animateImageTransition(
    uri: string,
    fromFrame: PulpoImageTransitionFrame,
    toFrame: PulpoImageTransitionFrame,
    opening: boolean,
  ): Promise<void>
  previewFile(uri: string, title: string): Promise<void>
}

export default requireOptionalNativeModule<PulpoAttachmentPreviewModule>('PulpoAttachmentPreview')
