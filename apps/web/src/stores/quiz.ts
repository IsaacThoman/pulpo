import { create } from 'zustand'
import type { QuizAnswers } from '@pulpo/client-core/quiz'

export interface QuizProgress {
  mode: 'quiz' | 'cards'
  /** Question on screen. */
  question: number
  answers: QuizAnswers
  finished: boolean
  card: number
  flipped: boolean
}

export const INITIAL_QUIZ_PROGRESS: QuizProgress = { mode: 'quiz', question: 0, answers: {}, finished: false, card: 0, flipped: false }

interface QuizState {
  /** By quiz source, so progress survives virtualized messages unmounting while the page is open. */
  progress: Record<string, QuizProgress>
  update: (key: string, change: Partial<QuizProgress> | ((current: QuizProgress) => Partial<QuizProgress>)) => void
}

export const useQuizStore = create<QuizState>()((set) => ({
  progress: {},
  update: (key, change) => set((state) => {
    const current = state.progress[key] ?? INITIAL_QUIZ_PROGRESS
    const next = typeof change === 'function' ? change(current) : change
    return { progress: { ...state.progress, [key]: { ...current, ...next } } }
  }),
}))
