import { NativeModule, requireOptionalNativeModule } from 'expo'

export interface PulpoImageTransitionFrame {
  x: number
  y: number
  width: number
  height: number
  cornerRadius: number
  sourceNativeId?: string
}

export interface PulpoImageGalleryItem {
  id: string
  sourceNativeId?: string
  title: string
  uri: string
}

declare class PulpoAttachmentPreviewModule extends NativeModule {
  animateImageTransition(
    uri: string,
    fromFrame: PulpoImageTransitionFrame,
    toFrame: PulpoImageTransitionFrame,
    opening: boolean,
  ): Promise<void>
  previewImages(
    items: PulpoImageGalleryItem[],
    initialIndex: number,
    sourceFrame?: PulpoImageTransitionFrame,
  ): Promise<void>
  previewFile(uri: string, title: string): Promise<void>
}

export default requireOptionalNativeModule<PulpoAttachmentPreviewModule>('PulpoAttachmentPreview')
