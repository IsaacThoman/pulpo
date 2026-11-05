import { QUIZ_MIME_TYPE, serializeQuiz, type Quiz } from '@pulpo/client-core/quiz'
import { downloadCode } from '@/lib/code-download'
import { saveContentToFiles, type Saved, type SaveToFilesInput } from './use-save-to-files'

export function downloadQuiz(quiz: Quiz, name: string): void {
  downloadCode(serializeQuiz(quiz), name, QUIZ_MIME_TYPE)
}

/** Uploads the quiz as a `.quiz` file. */
export function saveQuizToFiles(quiz: Quiz, input: SaveToFilesInput): Promise<Saved> {
  return saveContentToFiles(new Blob([serializeQuiz(quiz)], { type: QUIZ_MIME_TYPE }), input)
}
