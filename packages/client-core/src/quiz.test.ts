import { describe, expect, it } from 'vitest'
import { filePreviewKind } from './files/display.js'
import { parseQuiz, quizFileName, quizFlashcards, quizResultsMessage, quizScore, serializeQuiz, splitQuizBlocks } from './quiz.js'

// Kept in order so the tests below can name options by index.
const question = { prompt: 'Which cipher is unconditionally secure?', options: ['AES', 'One-time pad', 'RSA'], answer: 1, shuffle: false as const }
const correctOption = (item: { options: string[]; answer: number }) => item.options[item.answer]

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
    expect(quiz?.questions.map(correctOption)).toEqual(['no', 'z'])
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

describe('option shuffling', () => {
  const parseQuestion = (item: Record<string, unknown>) => parseQuiz(JSON.stringify({ questions: [item] }))!.questions[0]!

  it('spreads correct answers evenly across positions', () => {
    const counts = [0, 0, 0, 0]
    for (let index = 0; index < 800; index += 1) {
      const item = parseQuestion({ prompt: `Question ${index}?`, options: ['Right', 'Wrong 1', 'Wrong 2', 'Wrong 3'], answer: 0 })
      expect(correctOption(item)).toBe('Right')
      expect([...item.options].sort()).toEqual(['Right', 'Wrong 1', 'Wrong 2', 'Wrong 3'])
      counts[item.answer]! += 1
    }
    for (const count of counts) expect(count).toBeGreaterThan(150)
  })

  it('shuffles the same way every time, whatever order the options came in', () => {
    const item = { prompt: 'Largest planet?', options: ['Jupiter', 'Mars', 'Venus', 'Saturn', 'Earth'], answer: 0 }
    const first = parseQuestion(item)
    expect(parseQuestion(item)).toEqual(first)
    expect(parseQuestion({ ...item, options: [...item.options].reverse(), answer: 4 })).toEqual(first)
    const quiz = parseQuiz(JSON.stringify({ questions: [item] }))!
    expect(parseQuiz(serializeQuiz(quiz))).toEqual(quiz)
  })

  it('keeps the written order when a question turns shuffling off', () => {
    const item = parseQuestion({ prompt: 'Order these', options: ['First', 'Second', 'Third'], answer: 2, shuffle: false })
    expect(item).toEqual({ prompt: 'Order these', options: ['First', 'Second', 'Third'], answer: 2, shuffle: false })
    expect(serializeQuiz({ questions: [item], cards: [] })).toContain('"shuffle": false')
  })

  it('keeps "of the above" options in place', () => {
    for (let index = 0; index < 50; index += 1) {
      const item = parseQuestion({ prompt: `Prime ${index}?`, options: ['2', 'Nine', 'Fifteen', 'All of the above', 'None of these'], answer: 0 })
      expect(item.options.slice(3)).toEqual(['All of the above', 'None of these'])
      expect(correctOption(item)).toBe('2')
    }
  })

  it('keeps true/false, yes/no, and options that name others by letter in order', () => {
    expect(parseQuestion({ prompt: 'Is it?', options: ['False', 'True'], answer: 1 }).options).toEqual(['False', 'True'])
    expect(parseQuestion({ prompt: 'Is it?', options: ['Yes', 'No'], answer: 1 }).options).toEqual(['Yes', 'No'])
    for (const reference of ['A and C', 'B, C, and D only', 'Both A and B', 'Option B', 'neither (A) nor (B)']) {
      const options = ['Red', 'Green', 'Blue', reference]
      expect(parseQuestion({ prompt: `Which colors? ${reference}`, options, answer: 0 }).options).toEqual(options)
    }
  })

  it('sorts options that are all plain numbers', () => {
    const item = parseQuestion({ prompt: '6 × 7?', options: ['42', '36', '$48$', '1,000', '-3.5'], answer: 0 })
    expect(item.options).toEqual(['-3.5', '36', '42', '$48$', '1,000'])
    expect(correctOption(item)).toBe('42')
    expect(parseQuestion({ prompt: 'Rate?', options: ['50%', '$5', '25%'], answer: 1 }).options).toEqual(['$5', '25%', '50%'])
  })
})

describe('quiz helpers', () => {
  const quiz = parseQuiz(JSON.stringify({
    title: 'Crypto: ch/1',
    questions: [question, { prompt: '2 + 2?', options: ['3', '4'], answer: 1, explanation: 'Arithmetic.' }, { prompt: 'Skip me', options: ['a', 'b'], answer: 0, shuffle: false }],
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
