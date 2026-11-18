/**
 * Shared reading of threads, side chats, and forks for every client (see
 * packages/contracts/src/threads.ts for what they are).
 */

/**
 * How a thread's reply ended, from the word the server wrote in its thread update
 * (threadReportText on the server).
 */
export type ThreadReportOutcome = 'finished' | 'failed' | 'stopped' | 'incomplete' | 'other'

export interface ThreadReport {
  threadId: string
  title: string
  outcome: ThreadReportOutcome
  /** The outcome as the server wrote it, for outcomes this client does not know. */
  outcomeText: string
  body: string
}

export interface ThreadUpdate {
  /** "Thread update" or "Thread updates (2)". */
  heading: string
  reports: ThreadReport[]
}

const REPORT_HEADING = /^### Thread “(.*)” (.+)\r?\nThread id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[ \t]*$/gim

function outcomeOf(text: string): ThreadReportOutcome {
  switch (text.trim().toLowerCase()) {
    case 'finished': return 'finished'
    case 'failed': return 'failed'
    case 'was stopped': return 'stopped'
    case 'stopped before finishing': return 'incomplete'
    default: return 'other'
  }
}

/**
 * The thread reports in a thread update's message, the turn the server starts in a chat when its
 * threads stop working. The text reads as plain prose in apps that don't know about threads:
 *
 *   Thread update — sent automatically when a thread you started stops working.
 *
 *   ### Thread “Compare CRM pricing” finished
 *   Thread id: <uuid>
 *
 *   <the thread's reply>
 *
 * A report's heading must be followed by its `Thread id:` line, so headings inside a thread's own
 * reply stay part of its body. Text that isn't a thread update has no reports.
 */
export function parseThreadUpdate(text: string): ThreadUpdate {
  const headings = [...text.matchAll(REPORT_HEADING)]
  const preamble = (headings[0] ? text.slice(0, headings[0].index) : text).trim()
  return {
    heading: preamble.split(' — ')[0]?.trim() || 'Thread update',
    reports: headings.map((match, index) => {
      const start = match.index + match[0].length
      const end = headings[index + 1]?.index ?? text.length
      return {
        threadId: match[3]!.toLowerCase(),
        title: match[1]!.trim() || 'Thread',
        outcome: outcomeOf(match[2]!),
        outcomeText: match[2]!.trim(),
        body: text.slice(start, end).trim(),
      }
    }),
  }
}

/** Whether a report is long enough to start collapsed. */
export function isLongThreadReport(body: string): boolean {
  return body.length > 600 || body.split('\n').length > 10
}

/**
 * Markdown as plain text for a short preview: no emphasis marks, headings, list markers, links,
 * code fences, or table rules, including marks a reply still streaming hasn't closed yet. The
 * server summarizes threads the same way.
 */
export function markdownPreviewText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|\s)[*_](?=\S)/g, '$1')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Commands typed at the start of a message in a saved chat. Only these exact commands are taken;
 * any other message that starts with "/" is sent as written.
 */
export type ComposerCommand =
  /** `/btw <question>`: ask in a side chat. An empty question opens an empty side chat. */
  | { kind: 'btw'; question: string }
  /** `/fork`: continue in a new chat from the latest reply. */
  | { kind: 'fork' }

export type ComposerCommandName = ComposerCommand['kind']

export const COMPOSER_COMMANDS: readonly ComposerCommandName[] = ['btw', 'fork']

/** The command a message runs, or null when it is an ordinary message. */
export function parseComposerCommand(text: string, available: readonly ComposerCommandName[] = COMPOSER_COMMANDS): ComposerCommand | null {
  const trimmed = text.trim()
  const btw = /^\/btw(?:\s+([\s\S]*))?$/i.exec(trimmed)
  if (btw && available.includes('btw')) return { kind: 'btw', question: (btw[1] ?? '').trim() }
  if (/^\/fork$/i.test(trimmed) && available.includes('fork')) return { kind: 'fork' }
  return null
}

/**
 * The commands to suggest while a draft is being typed: those whose name starts with what follows
 * a leading "/", until the draft has more than the command (or `/btw` and its question).
 */
export function matchingComposerCommands(text: string, available: readonly ComposerCommandName[] = COMPOSER_COMMANDS): ComposerCommandName[] {
  const match = /^\/([a-z]*)(\s[\s\S]*)?$/i.exec(text.trimStart())
  if (!match) return []
  const typed = match[1]!.toLowerCase()
  const rest = match[2]
  return available.filter((name) => rest === undefined ? name.startsWith(typed) : name === typed && name === 'btw')
}
