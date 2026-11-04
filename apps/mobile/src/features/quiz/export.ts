import { QUIZ_MIME_TYPE, quizFileName, serializeQuiz, type Quiz } from '@pulpo/client-core/quiz'
import type { QueryClient } from '@tanstack/react-query'
import * as Sharing from 'expo-sharing'
import { textExportFile } from '../files/api'
import { enqueueUploads } from '../files/uploads'

export async function shareQuiz(quiz: Quiz): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.')
  const file = textExportFile(quizFileName(quiz), serializeQuiz(quiz))
  await Sharing.shareAsync(file.uri, { mimeType: QUIZ_MIME_TYPE, dialogTitle: file.name })
}

/** Uploads the quiz into My files; resolves once the upload is queued. */
export async function saveQuizToFiles(quiz: Quiz, namespace: string, client: QueryClient): Promise<void> {
  const file = textExportFile(quizFileName(quiz), serializeQuiz(quiz))
  await enqueueUploads(namespace, null, [{ uri: file.uri, name: file.name, mimeType: QUIZ_MIME_TYPE, sizeBytes: file.size }], client)
}
