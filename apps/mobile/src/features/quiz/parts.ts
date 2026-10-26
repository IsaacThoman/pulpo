import { parseQuiz, splitQuizBlocks, type Quiz } from '@pulpo/client-core/quiz'

/** A reply's text as rendered: Markdown, with each quiz block as a card of its own. */
export type AssistantMarkdownPart =
  | { kind: 'markdown'; text: string }
  | { kind: 'quiz'; source: string; quiz: Quiz }
  /** A quiz block still streaming in. */
  | { kind: 'building' }

const MAX_PARSED = 50
/** Streaming re-splits the reply on every update; finished blocks are parsed once. */
const parsed = new Map<string, Quiz | null>()

function cachedQuiz(source: string): Quiz | null {
  if (parsed.has(source)) return parsed.get(source)!
  const quiz = parseQuiz(source)
  if (parsed.size >= MAX_PARSED) parsed.delete(parsed.keys().next().value!)
  parsed.set(source, quiz)
  return quiz
}

/** The block as it was written, for a quiz that can't be shown. */
function fence(source: string): string {
  const longest = Math.max(2, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length))
  const marker = '`'.repeat(longest + 1)
  return `${marker}quiz\n${source}\n${marker}`
}

/**
 * Splits a reply around its quiz blocks. A block still streaming in is a placeholder; one that
 * doesn't parse once complete stays in the Markdown as a code block.
 */
export function assistantMarkdownParts(markdown: string, streaming: boolean): AssistantMarkdownPart[] {
  const parts: AssistantMarkdownPart[] = []
  const pushMarkdown = (text: string) => {
    const last = parts[parts.length - 1]
    if (last?.kind === 'markdown') last.text = `${last.text}\n${text}`
    else parts.push({ kind: 'markdown', text })
  }
  for (const segment of splitQuizBlocks(markdown)) {
    if (segment.kind === 'markdown') {
      pushMarkdown(segment.text)
      continue
    }
    if (!segment.closed && streaming) {
      parts.push({ kind: 'building' })
      continue
    }
    const quiz = cachedQuiz(segment.source)
    if (quiz) parts.push({ kind: 'quiz', source: segment.source, quiz })
    else pushMarkdown(fence(segment.source))
  }
  return parts
}
