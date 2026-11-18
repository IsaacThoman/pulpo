/**
 * Reading the message of a thread update: the turn the server starts in a chat when its threads
 * stop working. The text reads as plain prose to apps that don't know about threads:
 *
 *   Thread update — sent automatically when a thread you started stops working.
 *
 *   ### Thread “Compare CRM pricing” finished
 *   Thread id: <uuid>
 *
 *   <the thread's reply>
 */

/** How the thread's reply ended, from the word the server wrote. */
export type ThreadReportOutcome = 'finished' | 'failed' | 'stopped' | 'incomplete' | 'other'

export interface ThreadReport {
  threadId: string
  title: string
  outcome: ThreadReportOutcome
  /** The outcome as the server wrote it, for outcomes this client does not know. */
  outcomeText: string
  body: string
}

const HEADING = /^### Thread “(.*)” (.+)\r?\nThread id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[ \t]*$/gim

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
 * The thread reports in a thread update's message, in order. A report's heading must be followed
 * by its `Thread id:` line, so headings inside a thread's own reply stay part of its body.
 */
export function parseThreadUpdate(text: string): ThreadReport[] {
  const headings = [...text.matchAll(HEADING)]
  return headings.map((match, index) => {
    const start = match.index + match[0].length
    const end = headings[index + 1]?.index ?? text.length
    return {
      threadId: match[3]!.toLowerCase(),
      title: match[1]!,
      outcome: outcomeOf(match[2]!),
      outcomeText: match[2]!.trim(),
      body: text.slice(start, end).trim(),
    }
  })
}

/** Whether a report is long enough to start collapsed. */
export function isLongReport(body: string): boolean {
  return body.length > 600 || body.split('\n').length > 10
}
