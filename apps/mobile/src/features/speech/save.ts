import type { QueryClient } from '@tanstack/react-query'
import { shareLocalFile } from '../../native/shareFile'
import { exportFile } from '../files/api'
import { enqueueUploads } from '../files/uploads'
import { speechPlayback } from './state'

/** The message being read as one audio file, generating any of it not yet generated. */
async function speechExport() {
  const audio = await speechPlayback.audioFile()
  return { file: exportFile(audio.name, audio.bytes), mimeType: audio.mimeType }
}

/** Opens the share sheet with the message's speech, to save it to the device or send it. */
export async function shareSpeechAudio(): Promise<void> {
  const { file, mimeType } = await speechExport()
  await shareLocalFile(file.uri, file.name, mimeType)
}

/** Uploads the message's speech into My files; resolves once the upload is queued. */
export async function saveSpeechToFiles(namespace: string, client: QueryClient): Promise<void> {
  const { file, mimeType } = await speechExport()
  await enqueueUploads(namespace, null, [{ uri: file.uri, name: file.name, mimeType, sizeBytes: file.size }], client)
}
