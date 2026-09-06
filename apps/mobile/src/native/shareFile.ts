import * as Sharing from 'expo-sharing'

export async function shareLocalFile(uri: string, name: string, mimeType?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device')
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: name })
}
