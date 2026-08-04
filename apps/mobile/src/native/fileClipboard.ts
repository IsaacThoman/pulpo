import { Platform } from 'react-native'
import PulpoFileClipboard from '../../modules/pulpo-file-clipboard'

export const supportsFileClipboard = Platform.OS === 'ios' && PulpoFileClipboard !== null

export async function copyFile(uri: string): Promise<void> {
  if (!PulpoFileClipboard) throw new Error('Copy file is unavailable on this platform.')
  await PulpoFileClipboard.copyFile(uri)
}
