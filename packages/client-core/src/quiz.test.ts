import { describe, expect, it } from 'vitest'
import { filePreviewKind } from './files/display.js'
import { parseQuiz, quizFileName, quizFlashcards, quizResultsMessage, quizScore, serializeQuiz, splitQuizBlocks } from './quiz.js'

const question = { prompt: 'Which cipher is unconditionally secure?', options: ['AES', 'One-time pad', 'RSA'], answer: 1 }

describe('parseQuiz', () => {
  it('reads questions, cards, and a title', () => {
    expect(parseQuiz(JSON.stringify({
      title: ' Chapter 1 ',
      questions: [{ ...question, hint: 'Key as long as the message', explanation: 'Every plaintext is equally likely.' }],
      cards: [{ front: 'X.800', back: 'Attacks, mechanisms, services' }],
    }))).toEqual({
      title: 'Chapter 1',
      questions: [{ ...question, hint: 'Key as long as the message', explanation: 'Every plaintext is equally likely.' }],
      cards: [{ front: 'X.800', back: 'Attacks, mechanisms, services' }],
    })
  })

  it('accepts common aliases and answers given as text or a letter', () => {
    const quiz = parseQuiz(JSON.stringify({
      questions: [
        { question: 'A?', choices: ['yes', 'no'], answer: 'No' },
        { q: 'B?', options: ['x', 'y', 'z'], correct: 'c)' },
      ],
      flashcards: [{ term: 'Nonce', definition: 'Number used once' }],
    }))
    expect(quiz?.questions.map((item) => item.answer)).toEqual([1, 2])
    expect(quiz?.cards).toEqual([{ front: 'Nonce', back: 'Number used once' }])
  })

  it('treats a bare list as questions', () => {
    expect(parseQuiz(JSON.stringify([question]))?.questions).toHaveLength(1)
  })

  it('drops unusable items and rejects a quiz with nothing left', () => {
    const quiz = parseQuiz(JSON.stringify({
      questions: [
        question,
        { prompt: 'No options' },
        { prompt: 'One option', options: ['only'], answer: 0 },
        { prompt: 'Answer out of range', options: ['a', 'b'], answer: 2 },
        { prompt: 'Blank option', options: ['a', ' '], answer: 0 },
      ],
      cards: [{ front: 'no back' }],
    }))
    expect(quiz?.questions).toEqual([question])
    expect(quiz?.cards).toEqual([])
    expect(parseQuiz('{"questions": [{"prompt": "x"}]}')).toBeNull()
    expect(parseQuiz('{"questions": [')).toBeNull()
    expect(parseQuiz('"text"')).toBeNull()
  })
})

describe('quiz helpers', () => {
  const quiz = parseQuiz(JSON.stringify({
    title: 'Crypto: ch/1',
    questions: [question, { prompt: '2 + 2?', options: ['3', '4'], answer: 1, explanation: 'Arithmetic.' }, { prompt: 'Skip me', options: ['a', 'b'], answer: 0 }],
  }))!

  it('builds flashcards from questions when the quiz has none', () => {
    expect(quizFlashcards(quiz)[1]).toEqual({ front: '2 + 2?', back: '4\n\nArithmetic.' })
  })

  it('scores answers and reports what was missed', () => {
    const answers = { 0: 1, 1: 0 }
    expect(quizScore(quiz, answers)).toEqual({ correct: 1, answered: 2, total: 3 })
    expect(quizResultsMessage(quiz, answers)).toBe([
      'My results for "Crypto: ch/1": 1/3 correct.',
      '',
      'The ones I missed:',
      '2. 2 + 2?',
      '   My answer: 3',
      '   Correct answer: 4',
      '3. Skip me',
      '   I skipped this one.',
      '   Correct answer: a',
      '',
      'Can you explain these?',
    ].join('\n'))
    expect(quizResultsMessage(quiz, { 0: 1, 1: 1, 2: 0 })).toBe('My results for "Crypto: ch/1": 3/3 correct.')
  })

  it('round-trips through a .quiz file', () => {
    expect(parseQuiz(serializeQuiz(quiz))).toEqual(quiz)
    expect(quizFileName(quiz)).toBe('Crypto ch 1.quiz')
    expect(quizFileName({ questions: [question], cards: [] })).toBe('Quiz.quiz')
  })

  it('previews .quiz files as quizzes', () => {
    expect(filePreviewKind({ kind: 'blob', name: 'Ch1.quiz', mimeType: 'application/json', sizeBytes: 100 })).toBe('quiz')
  })
})

describe('splitQuizBlocks', () => {
  it('separates quiz fences from the surrounding Markdown', () => {
    expect(splitQuizBlocks('Intro\n\n```quiz\n{"a": 1}\n```\n\nOutro')).toEqual([
      { kind: 'markdown', text: 'Intro\n' },
      { kind: 'quiz', source: '{"a": 1}', closed: true },
      { kind: 'markdown', text: '\nOutro' },
    ])
  })

  it('marks a quiz that is still streaming', () => {
    expect(splitQuizBlocks('Here:\n```quiz\n{"questions": [')).toEqual([
      { kind: 'markdown', text: 'Here:' },
      { kind: 'quiz', source: '{"questions": [', closed: false },
    ])
  })

  it('leaves other code blocks alone, including quiz examples inside them', () => {
    const markdown = '````md\n```quiz\n{}\n```\n````\n\n```js\nlet a\n```'
    expect(splitQuizBlocks(markdown)).toEqual([{ kind: 'markdown', text: markdown }])
  })
})
