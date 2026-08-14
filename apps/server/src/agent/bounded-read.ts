export const READ_DEFAULT_LINE_LIMIT = 2_000
export const READ_MAX_LINE_LIMIT = 2_000
export const READ_MAX_LINE_CHARACTERS = 2_000
export const READ_MAX_OUTPUT_BYTES = 50 * 1024

const READ_OUTPUT_FOOTER_RESERVE_BYTES = 1_024
const READ_CONTENT_BYTES = READ_MAX_OUTPUT_BYTES - READ_OUTPUT_FOOTER_RESERVE_BYTES

export type AgentReadArguments = {
  path?: unknown
  offset?: unknown
  limit?: unknown
  readAll?: unknown
}

export type ParsedAgentReadArguments = {
  offset: number
  limit: number | null
  readAll: boolean
}

export type BoundedReadDetails = {
  kind: 'bounded_read'
  version: 1
  offset: number
  firstLine: number | null
  lastLine: number | null
  returnedLines: number
  nextOffset: number | null
  eof: boolean
  truncated: boolean
  longLines: number
  totalLines: number | null
  maxOutputBytes: number
}

function positiveInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`)
  }
  return Number(value)
}

export function parseAgentReadArguments(args: AgentReadArguments): ParsedAgentReadArguments {
  const readAll = args.readAll === undefined ? false : args.readAll
  if (typeof readAll !== 'boolean') throw new Error('readAll must be a boolean')
  if (readAll && (args.offset !== undefined || args.limit !== undefined)) {
    throw new Error('readAll cannot be combined with offset or limit')
  }
  return {
    offset: args.offset === undefined ? 1 : positiveInteger(args.offset, 'offset'),
    limit: readAll ? null : args.limit === undefined
      ? READ_DEFAULT_LINE_LIMIT
      : positiveInteger(args.limit, 'limit', READ_MAX_LINE_LIMIT),
    readAll,
  }
}

export function isBoundedReadDetails(value: unknown): value is BoundedReadDetails {
  if (!value || typeof value !== 'object') return false
  const details = value as Partial<BoundedReadDetails>
  return details.kind === 'bounded_read'
    && details.version === 1
    && Number.isInteger(details.offset)
    && Number.isInteger(details.returnedLines)
    && typeof details.eof === 'boolean'
    && typeof details.truncated === 'boolean'
}

function textLines(value: string): string[] {
  if (!value) return []
  const lines = value.split(/\r\n|\n|\r/u)
  if (/(?:\r\n|\n|\r)$/u.test(value)) lines.pop()
  return lines
}

function truncateLine(value: string): { text: string; truncated: boolean } {
  let text = ''
  let characters = 0
  for (const character of value) {
    if (characters >= READ_MAX_LINE_CHARACTERS) return { text, truncated: true }
    text += character
    characters += 1
  }
  return { text, truncated: false }
}

function rejectBinaryText(value: string): void {
  const sample = value.slice(0, 4_096)
  if (!sample) return
  let controls = 0
  for (const character of sample) {
    const code = character.codePointAt(0) ?? 0
    if (code === 0) throw new Error('Cannot read binary file as UTF-8 text')
    if (code < 9 || (code > 13 && code < 32)) controls += 1
  }
  if (controls / sample.length > 0.3) throw new Error('Cannot read binary file as UTF-8 text')
}

function footer(input: {
  eof: boolean
  totalLines: number
  firstLine: number | null
  lastLine: number | null
  nextOffset: number | null
  stopReason: 'line_limit' | 'byte_limit' | null
  longLines: number
}): string[] {
  const footers: string[] = []
  if (input.eof) {
    footers.push(input.totalLines === 0
      ? '[End of file - empty file.]'
      : `[End of file - ${input.totalLines} ${input.totalLines === 1 ? 'line' : 'lines'} total.]`)
  } else if (input.nextOffset !== null) {
    const range = input.firstLine === null ? 'No lines returned' : `Showing lines ${input.firstLine}-${input.lastLine}`
    const reason = input.stopReason === 'byte_limit' ? ` Output capped at ${READ_MAX_OUTPUT_BYTES / 1024} KiB.` : ''
    footers.push(`[${range}.${reason} Continue with offset=${input.nextOffset}.]`)
  }
  if (input.longLines > 0) {
    footers.push(`[${input.longLines} ${input.longLines === 1 ? 'line was' : 'lines were'} truncated at ${READ_MAX_LINE_CHARACTERS} characters. Use bash or grep for oversized single-line data.]`)
  }
  return footers
}

export function boundLegacyReadOutput(value: string, rawArgs: AgentReadArguments): { output: string; details: BoundedReadDetails } {
  const args = parseAgentReadArguments(rawArgs)
  rejectBinaryText(value)
  const lines = textLines(value)
  if (args.offset > lines.length && !(lines.length === 0 && args.offset === 1)) {
    throw new Error(`Offset ${args.offset} is out of range for this file (${lines.length} lines)`)
  }

  const rendered: string[] = []
  let renderedBytes = 0
  let longLines = 0
  let nextOffset: number | null = null
  let stopReason: 'line_limit' | 'byte_limit' | null = null
  const start = args.offset - 1
  const end = args.limit === null ? lines.length : Math.min(lines.length, start + args.limit)
  for (let index = start; index < end; index += 1) {
    const bounded = truncateLine(lines[index] ?? '')
    const suffix = bounded.truncated ? `... [line truncated at ${READ_MAX_LINE_CHARACTERS} characters]` : ''
    const line = `${index + 1}: ${bounded.text}${suffix}`
    const bytes = Buffer.byteLength(line, 'utf8') + (rendered.length ? 1 : 0)
    if (renderedBytes + bytes > READ_CONTENT_BYTES) {
      stopReason = 'byte_limit'
      nextOffset = index + 1
      break
    }
    rendered.push(line)
    renderedBytes += bytes
    if (bounded.truncated) longLines += 1
  }
  if (nextOffset === null && end < lines.length) {
    stopReason = 'line_limit'
    nextOffset = end + 1
  }

  const eof = nextOffset === null
  const firstLine = rendered.length ? args.offset : null
  const lastLine = rendered.length ? args.offset + rendered.length - 1 : null
  const footers = footer({ eof, totalLines: lines.length, firstLine, lastLine, nextOffset, stopReason, longLines })
  const output = [rendered.join('\n'), ...footers].filter(Boolean).join('\n\n')
  if (Buffer.byteLength(output, 'utf8') > READ_MAX_OUTPUT_BYTES) throw new Error('Bounded read output exceeded its safety limit')

  return {
    output,
    details: {
      kind: 'bounded_read',
      version: 1,
      offset: args.offset,
      firstLine,
      lastLine,
      returnedLines: rendered.length,
      nextOffset,
      eof,
      truncated: stopReason !== null || longLines > 0,
      longLines,
      totalLines: eof ? lines.length : null,
      maxOutputBytes: READ_MAX_OUTPUT_BYTES,
    },
  }
}
