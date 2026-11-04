import { QUIZ_MIME_TYPE, serializeQuiz, type Quiz } from '@pulpo/client-core/quiz'
import { fetchFolder, restoreFileNodes, trashFileNodes, uploadFile } from '@/features/files/api'
import { uniqueChildName } from '@/features/files/browser/sort'
import { downloadCode } from '@/lib/code-download'
import type { Saved, SaveToFilesInput } from './use-save-to-files'

export function downloadQuiz(quiz: Quiz, name: string): void {
  downloadCode(serializeQuiz(quiz), name, QUIZ_MIME_TYPE)
}

/**
 * Uploads the quiz as a `.quiz` file. Overwriting trashes the old file first so the name is free,
 * and restores it if the upload fails; saving separately numbers the name like the server does.
 */
export async function saveQuizToFiles(quiz: Quiz, { parentId, name, replaceId }: SaveToFilesInput): Promise<Saved> {
  const finalName = replaceId ? name : uniqueChildName(name, (await fetchFolder(parentId)).children)
  if (replaceId) await trashFileNodes([replaceId])
  try {
    const node = await uploadFile(parentId, new File([serializeQuiz(quiz)], finalName, { type: QUIZ_MIME_TYPE }))
    return { node, replacedId: replaceId ?? null }
  } catch (error) {
    if (replaceId) await restoreFileNodes([replaceId]).catch(() => undefined)
    throw error
  }
}
