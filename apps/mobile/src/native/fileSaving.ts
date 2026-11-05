import { Platform } from 'react-native'
import PulpoFileClipboard from '../../modules/pulpo-file-clipboard'

export const supportsSaveToPhotos = Platform.OS === 'ios' && typeof PulpoFileClipboard?.saveImageToPhotos === 'function'
export const supportsSaveToDevice = Platform.OS === 'ios' && typeof PulpoFileClipboard?.exportFile === 'function'

/** Adds a local image file to the photo library (add-only access). */
export async function saveImageToPhotos(uri: string): Promise<void> {
  if (!PulpoFileClipboard?.saveImageToPhotos) throw new Error('Saving to Photos is unavailable on this device.')
  await PulpoFileClipboard.saveImageToPhotos(uri)
}

/** Asks where to keep a copy of a local file; resolves `false` when the user cancelled. */
export async function saveFileToDevice(uri: string, name: string, _mimeType?: string): Promise<boolean> {
  if (!PulpoFileClipboard?.exportFile) throw new Error('Saving files is unavailable on this device.')
  return PulpoFileClipboard.exportFile(uri, name)
}
