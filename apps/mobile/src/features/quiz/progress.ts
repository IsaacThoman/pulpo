import type { QuizAnswers } from '@pulpo/client-core/quiz'
import { create } from 'zustand'

/**
 * Where someone is in a quiz, kept per quiz (by its source) for the session so it survives the
 * chat list unmounting its card while scrolled away.
 */
export interface QuizProgress {
  /** Unset until chosen: the quiz when it has questions, otherwise the flashcards. */
  mode?: 'quiz' | 'flashcards'
  answers: QuizAnswers
  question: number
  /** Showing the results, after the last question. */
  finished: boolean
  card: number
}

export const EMPTY_QUIZ_PROGRESS: QuizProgress = { answers: {}, question: 0, finished: false, card: 0 }

interface QuizProgressStore {
  progress: Record<string, QuizProgress>
  update: (key: string, change: Partial<QuizProgress>) => void
  /** Chooses an option; an answered question keeps its first answer. */
  answer: (key: string, question: number, option: number) => void
  retake: (key: string) => void
}

export const useQuizProgress = create<QuizProgressStore>((set) => {
  const change = (key: string, next: (current: QuizProgress) => QuizProgress) => set((state) => {
    const current = state.progress[key] ?? EMPTY_QUIZ_PROGRESS
    const updated = next(current)
    return updated === current ? state : { progress: { ...state.progress, [key]: updated } }
  })
  return {
    progress: {},
    update: (key, partial) => change(key, (current) => ({ ...current, ...partial })),
    answer: (key, question, option) => change(key, (current) => current.answers[question] === undefined
      ? { ...current, answers: { ...current.answers, [question]: option } }
      : current),
    retake: (key) => change(key, (current) => ({ ...current, answers: {}, question: 0, finished: false })),
  }
})
