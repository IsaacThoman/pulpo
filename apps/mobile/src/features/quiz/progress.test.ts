import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_QUIZ_PROGRESS, useQuizProgress } from './progress'

const progress = (key: string) => useQuizProgress.getState().progress[key] ?? EMPTY_QUIZ_PROGRESS

beforeEach(() => useQuizProgress.setState({ progress: {} }))

describe('quiz progress', () => {
  it('keeps each quiz’s place separately', () => {
    const { update } = useQuizProgress.getState()
    update('a', { question: 2, mode: 'quiz' })
    update('b', { card: 4, mode: 'flashcards' })
    expect(progress('a')).toMatchObject({ question: 2, mode: 'quiz', card: 0 })
    expect(progress('b')).toMatchObject({ question: 0, mode: 'flashcards', card: 4 })
  })

  it('locks a question to its first answer', () => {
    const { answer } = useQuizProgress.getState()
    answer('a', 0, 1)
    answer('a', 0, 2)
    answer('a', 3, 0)
    expect(progress('a').answers).toEqual({ 0: 1, 3: 0 })
  })

  it('retakes from the first question, keeping the chosen view and flashcard', () => {
    const { answer, retake, update } = useQuizProgress.getState()
    update('a', { mode: 'quiz', question: 4, finished: true, card: 2 })
    answer('a', 4, 1)
    retake('a')
    expect(progress('a')).toEqual({ mode: 'quiz', answers: {}, question: 0, finished: false, card: 2 })
  })
})
