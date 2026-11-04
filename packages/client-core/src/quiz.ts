/**
 * Interactive quizzes and flashcards. A model writes one as JSON in a ```quiz fenced block, and the
 * same JSON saved with a `.quiz` extension is a quiz file. Parsing is lenient: unusable questions or
 * cards are dropped, and only a block with nothing usable left is rejected.
 */

export const QUIZ_LANGUAGE = 'quiz'
export const QUIZ_EXTENSION = 'quiz'
export const QUIZ_MIME_TYPE = 'application/json'

export const MAX_QUIZ_QUESTIONS = 100
export const MAX_QUIZ_CARDS = 300
const MAX_OPTIONS = 8
const MAX_TEXT_LENGTH = 4000
const MAX_TITLE_LENGTH = 200

export interface QuizQuestion {
  prompt: string
  options: string[]
  /** Index of the correct option. */
  answer: number
  hint?: string
  explanation?: string
  /** False keeps the options in the order written; see `arrangeOptions`. */
  shuffle?: false
}

export interface QuizCard {
  front: string
  back: string
}

export interface Quiz {
  title?: string
  questions: QuizQuestion[]
  /** Flashcards the model wrote; see `quizFlashcards` for the cards to show. */
  cards: QuizCard[]
}

/** The option chosen for each question, by question index. */
export type QuizAnswers = Record<number, number>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

function firstText(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(item[key])
    if (value) return value
  }
  return undefined
}

function answerIndex(value: unknown, options: string[]): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value < options.length ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const exact = options.findIndex((option) => option === trimmed)
  if (exact >= 0) return exact
  const folded = options.findIndex((option) => option.toLowerCase() === trimmed.toLowerCase())
  if (folded >= 0) return folded
  // "B" or "b)" names the second option.
  const letter = /^([a-z])[).:]?$/i.exec(trimmed)?.[1]
  if (letter) {
    const index = letter.toLowerCase().charCodeAt(0) - 97
    if (index < options.length) return index
  }
  return null
}

function parseQuestion(value: unknown): QuizQuestion | null {
  const item = record(value)
  if (!item) return null
  const prompt = firstText(item, ['prompt', 'question', 'q'])
  const rawOptions = Array.isArray(item.options) ? item.options : Array.isArray(item.choices) ? item.choices : null
  if (!prompt || !rawOptions) return null
  const options = rawOptions.map((option) => text(option)).filter((option): option is string => Boolean(option))
  if (options.length < 2 || options.length > MAX_OPTIONS || options.length !== rawOptions.length) return null
  const answer = answerIndex(item.answer ?? item.correct ?? item.answerIndex, options)
  if (answer === null) return null
  const hint = firstText(item, ['hint'])
  const explanation = firstText(item, ['explanation', 'rationale'])
  const keepOrder = item.shuffle === false
  return {
    prompt,
    ...(keepOrder ? { options, answer } : arrangeOptions(prompt, options, answer)),
    ...(hint ? { hint } : {}),
    ...(explanation ? { explanation } : {}),
    ...(keepOrder ? { shuffle: false as const } : {}),
  }
}

// "All of the above", "None of these": keeps its place among the shuffled options.
const REFERS_TO_OTHERS = /\b(?:above|below)\s*[.!]?$|\bof\s+(?:these|those|them|the\s+(?:others?|options|answers|choices))\b/i
// "A and C", "B, C, and D only", "Option B": positions that shuffling would make wrong.
const REFERS_BY_LETTER = /^(?:(?:[Bb]oth|[Nn]either|[Oo]nly)\s+)?\(?[A-H]\)?(?:\s*,\s*\(?[A-H]\)?)*,?\s+(?:and|n?or|&)\s+\(?[A-H]\)?(?:\s+only)?\s*\.?$|\b(?:[Oo]ptions?|[Cc]hoices?|[Aa]nswers?)\s+\(?[A-H]\)?(?![\w'])/
const FIXED_PAIRS = [['true', 'false'], ['yes', 'no']]
const PLAIN_NUMBER = /^[-+\u2212]?[$€£]?(?:\d{1,3}(?:,\d{3})+|\d+|(?=\.\d))(?:\.\d+)?%?$/

function numericValue(option: string): number | null {
  const plain = /^\$[^$]+\$$/.test(option) ? option.slice(1, -1).trim() : option
  if (!PLAIN_NUMBER.test(plain)) return null
  const value = Number(plain.replace(/[$€£%,]/g, '').replace('\u2212', '-'))
  return Number.isFinite(value) ? value : null
}

/** A 32-bit FNV-1a hash, to seed `seededRandom`. */
function hash(value: string): number {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }
  return result >>> 0
}

/** Mulberry32: the same seed always gives the same sequence in [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** The new position of each option, as indexes into the original list. */
function optionOrder(prompt: string, options: string[]): number[] {
  const indexes = options.map((_, index) => index)
  const lower = options.map((option) => option.toLowerCase())
  if (options.some((option) => REFERS_BY_LETTER.test(option))) return indexes
  if (FIXED_PAIRS.some((pair) => pair.length === lower.length && pair.every((word) => lower.includes(word)))) return indexes
  const numbers = options.map(numericValue)
  if (numbers.every((value) => value !== null)) return indexes.sort((a, b) => numbers[a]! - numbers[b]!)

  const slots = indexes.filter((index) => !REFERS_TO_OTHERS.test(options[index]!))
  // Starting from a canonical order and seeding with the content, not the order, means a quiz
  // shuffles the same way every time it renders, on every platform, and again after it is saved.
  const moving = [...slots].sort((a, b) => options[a]! < options[b]! ? -1 : options[a]! > options[b]! ? 1 : a - b)
  const random = seededRandom(hash([prompt, ...moving.map((index) => options[index]!)].join('\u0000')))
  for (let index = moving.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[moving[index], moving[other]] = [moving[other]!, moving[index]!]
  }
  const order = [...indexes]
  slots.forEach((slot, position) => { order[slot] = moving[position]! })
  return order
}

/**
 * Models tend to write the correct option first, so a question's options are shuffled, the same
 * way on every render. Options are kept in order when shuffling would mislead: true/false and
 * yes/no pairs, options that name others by letter ("A and C"), and options like "None of the
 * above", which stay where they are. Plain numbers are sorted instead.
 */
export function arrangeOptions(prompt: string, options: string[], answer: number): { options: string[]; answer: number } {
  const order = optionOrder(prompt, options)
  return { options: order.map((index) => options[index]!), answer: order.indexOf(answer) }
}

function parseCard(value: unknown): QuizCard | null {
  const item = record(value)
  if (!item) return null
  const front = firstText(item, ['front', 'term', 'question'])
  const back = firstText(item, ['back', 'definition', 'answer'])
  return front && back ? { front, back } : null
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null, max: number): T[] {
  if (!Array.isArray(value)) return []
  return value.map(parse).filter((item): item is T => item !== null).slice(0, max)
}

/** The quiz in a block or file, or null when nothing in it can be shown. */
export function parseQuiz(source: string): Quiz | null {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    return null
  }
  // A bare list of questions is a quiz too.
  const root = Array.isArray(value) ? { questions: value } : record(value)
  if (!root) return null
  const questions = parseList(root.questions, parseQuestion, MAX_QUIZ_QUESTIONS)
  const cards = parseList(root.cards ?? root.flashcards, parseCard, MAX_QUIZ_CARDS)
  if (!questions.length && !cards.length) return null
  const title = text(root.title, MAX_TITLE_LENGTH)
  return { ...(title ? { title } : {}), questions, cards }
}

/** The quiz's own flashcards, or one per question (the question, then its answer) when it has none. */
export function quizFlashcards(quiz: Quiz): QuizCard[] {
  if (quiz.cards.length) return quiz.cards
  return quiz.questions.map((question) => ({
    front: question.prompt,
    back: [question.options[question.answer], question.explanation].filter(Boolean).join('\n\n'),
  }))
}

/** The quiz as a `.quiz` file's contents. */
export function serializeQuiz(quiz: Quiz): string {
  return `${JSON.stringify({ version: 1, ...quiz }, null, 2)}\n`
}

export function quizFileName(quiz: Quiz): string {
  const base = (quiz.title ?? '').normalize('NFKC').replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${base || 'Quiz'}.${QUIZ_EXTENSION}`
}

export function isQuizFileName(name: string): boolean {
  return name.trim().toLowerCase().endsWith(`.${QUIZ_EXTENSION}`)
}

export function quizScore(quiz: Quiz, answers: QuizAnswers): { correct: number; answered: number; total: number } {
  let correct = 0
  let answered = 0
  quiz.questions.forEach((question, index) => {
    const chosen = answers[index]
    if (chosen === undefined) return
    answered += 1
    if (chosen === question.answer) correct += 1
  })
  return { correct, answered, total: quiz.questions.length }
}

/** A chat message reporting the score and every missed or skipped question, for the model to go over. */
export function quizResultsMessage(quiz: Quiz, answers: QuizAnswers): string {
  const { correct, total } = quizScore(quiz, answers)
  const heading = quiz.title ? `My results for "${quiz.title}": ${correct}/${total} correct.` : `My quiz results: ${correct}/${total} correct.`
  const missed = quiz.questions.flatMap((question, index) => {
    const chosen = answers[index]
    if (chosen === question.answer) return []
    const lines = [`${index + 1}. ${question.prompt}`]
    lines.push(chosen === undefined ? '   I skipped this one.' : `   My answer: ${question.options[chosen]}`)
    lines.push(`   Correct answer: ${question.options[question.answer]}`)
    return [lines.join('\n')]
  })
  if (!missed.length) return heading
  return `${heading}\n\nThe ones I missed:\n${missed.join('\n')}\n\nCan you explain these?`
}

export type QuizMarkdownSegment =
  | { kind: 'markdown'; text: string }
  /** `closed` is false while the fence is still streaming in. */
  | { kind: 'quiz'; source: string; closed: boolean }

/**
 * Splits Markdown around its ```quiz blocks, for renderers that cannot embed components inside
 * Markdown. Other fenced blocks stay in the Markdown, so a quiz example inside one is left alone.
 */
export function splitQuizBlocks(markdown: string): QuizMarkdownSegment[] {
  const lines = markdown.split('\n')
  const segments: QuizMarkdownSegment[] = []
  let buffer: string[] = []
  const flush = () => {
    const joined = buffer.join('\n')
    if (joined.trim()) segments.push({ kind: 'markdown', text: joined })
    buffer = []
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const fence = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/.exec(line)
    if (!fence) {
      buffer.push(line)
      index += 1
      continue
    }
    const marker = fence[1]!
    const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
    let end = index + 1
    while (end < lines.length && !closing.test(lines[end]!)) end += 1
    const closed = end < lines.length
    if (fence[2]!.toLowerCase() === QUIZ_LANGUAGE) {
      flush()
      segments.push({ kind: 'quiz', source: lines.slice(index + 1, end).join('\n'), closed })
    } else {
      buffer.push(...lines.slice(index, closed ? end + 1 : end))
    }
    index = end + 1
  }
  flush()
  return segments
}
