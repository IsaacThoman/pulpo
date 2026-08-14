import { createReadStream } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'

export const READ_DEFAULT_LINE_LIMIT = 2_000
export const READ_MAX_LINE_LIMIT = 2_000
export const READ_MAX_LINE_CHARACTERS = 2_000
export const READ_MAX_OUTPUT_BYTES = 50 * 1024
export const READ_RESULT_VERSION = 1

const READ_OUTPUT_FOOTER_RESERVE_BYTES = 1_024
const READ_CONTENT_BYTES = READ_MAX_OUTPUT_BYTES - READ_OUTPUT_FOOTER_RESERVE_BYTES
const BINARY_SAMPLE_BYTES = 4_096

export type ReadArguments = {
  path?: unknown
  offset?: unknown
  limit?: unknown
  readAll?: unknown
}

export type ParsedReadArguments = {
  offset: number
  limit: number | null
  readAll: boolean
}

export type ReadResultDetails = {
  kind: 'bounded_read'
  version: typeof READ_RESULT_VERSION
  offset: number
  firstLine: number | null
  lastLine: number | null
  returnedLines: number
  nextOffset: number | null
  eof: boolean
  truncated: boolean
  longLines: number
  totalLines: number | null
  maxOutputBytes: typeof READ_MAX_OUTPUT_BYTES
}

export type ReadResult = {
  output: string
  details: ReadResultDetails
}

export async function resolveReadableWorkspacePath(root: string, requested: string): Promise<string> {
  const [resolvedRoot, resolved] = await Promise.all([realpath(root), realpath(requested)])
  const fromRoot = relative(resolvedRoot, resolved)
  if (resolved !== resolvedRoot && (fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot))) {
    throw new Error('Path escapes /workspace')
  }
  const metadata = await stat(resolved)
  if (!metadata.isFile()) throw new Error('Path must be a regular file')
  return resolved
}

function positiveInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`)
  }
  return Number(value)
}

export function parseReadArguments(args: ReadArguments): ParsedReadArguments {
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

async function assertTextFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    const sample = Buffer.allocUnsafe(BINARY_SAMPLE_BYTES)
    const { bytesRead } = await handle.read(sample, 0, sample.byteLength, 0)
    if (!bytesRead) return
    const bytes = sample.subarray(0, bytesRead)
    let controls = 0
    for (const byte of bytes) {
      if (byte === 0) throw new Error('Cannot read binary file as UTF-8 text')
      if (byte < 9 || (byte > 13 && byte < 32)) controls += 1
    }
    if (controls / bytes.length > 0.3) throw new Error('Cannot read binary file as UTF-8 text')
  } finally {
    await handle.close()
  }
}

function outputFooter(input: {
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

export async function readTextFile(path: string, rawArgs: ReadArguments): Promise<ReadResult> {
  const args = parseReadArguments(rawArgs)
  await assertTextFile(path)

  const stream = createReadStream(path)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const rendered: string[] = []
  let renderedBytes = 0
  let lineNumber = 0
  let currentLine = ''
  let currentCharacters = 0
  let currentLineTruncated = false
  let currentLineOpen = false
  let previousWasCarriageReturn = false
  let stopReason: 'line_limit' | 'byte_limit' | null = null
  let nextOffset: number | null = null
  let longLines = 0

  const lineLimitReached = () => args.limit !== null && rendered.length >= args.limit

  const finishLine = (): boolean => {
    lineNumber += 1
    if (lineNumber < args.offset) {
      currentLine = ''
      currentCharacters = 0
      currentLineTruncated = false
      currentLineOpen = false
      return false
    }
    if (lineLimitReached()) {
      stopReason = 'line_limit'
      nextOffset = lineNumber
      return true
    }
    const suffix = currentLineTruncated ? `... [line truncated at ${READ_MAX_LINE_CHARACTERS} characters]` : ''
    const line = `${lineNumber}: ${currentLine}${suffix}`
    const bytes = Buffer.byteLength(line, 'utf8') + (rendered.length ? 1 : 0)
    if (renderedBytes + bytes > READ_CONTENT_BYTES) {
      stopReason = 'byte_limit'
      nextOffset = lineNumber
      return true
    }
    rendered.push(line)
    renderedBytes += bytes
    if (currentLineTruncated) longLines += 1
    currentLine = ''
    currentCharacters = 0
    currentLineTruncated = false
    currentLineOpen = false
    return false
  }

  const processText = (text: string): boolean => {
    for (const character of text) {
      if (character === '\0') throw new Error('Cannot read binary file as UTF-8 text')
      if (previousWasCarriageReturn) {
        previousWasCarriageReturn = false
        if (character === '\n') continue
      }
      if (lineLimitReached() && !currentLineOpen) {
        stopReason = 'line_limit'
        nextOffset = lineNumber + 1
        return true
      }
      if (character === '\r' || character === '\n') {
        if (finishLine()) return true
        previousWasCarriageReturn = character === '\r'
        continue
      }
      currentLineOpen = true
      if (currentCharacters < READ_MAX_LINE_CHARACTERS) currentLine += character
      else currentLineTruncated = true
      currentCharacters += 1
    }
    return false
  }

  let stopped = false
  try {
    for await (const chunk of stream) {
      if (processText(decoder.decode(chunk as Buffer, { stream: true }))) {
        stopped = true
        break
      }
    }
    if (!stopped) {
      if (processText(decoder.decode())) stopped = true
      if (!stopped && currentLineOpen) stopped = finishLine()
    }
  } catch (error) {
    if (error instanceof TypeError) throw new Error('File is not valid UTF-8 text', { cause: error })
    throw error
  } finally {
    stream.destroy()
  }

  const eof = !stopped && stopReason === null
  if (eof && rendered.length === 0 && args.offset > lineNumber && !(lineNumber === 0 && args.offset === 1)) {
    throw new Error(`Offset ${args.offset} is out of range for this file (${lineNumber} lines)`)
  }
  const firstLine = rendered.length ? args.offset : null
  const lastLine = rendered.length ? args.offset + rendered.length - 1 : null
  const footers = outputFooter({ eof, totalLines: lineNumber, firstLine, lastLine, nextOffset, stopReason, longLines })
  const output = [rendered.join('\n'), ...footers].filter(Boolean).join('\n\n')
  if (Buffer.byteLength(output, 'utf8') > READ_MAX_OUTPUT_BYTES) throw new Error('Bounded read output exceeded its safety limit')

  return {
    output,
    details: {
      kind: 'bounded_read',
      version: READ_RESULT_VERSION,
      offset: args.offset,
      firstLine,
      lastLine,
      returnedLines: rendered.length,
      nextOffset,
      eof,
      truncated: stopReason !== null || longLines > 0,
      longLines,
      totalLines: eof ? lineNumber : null,
      maxOutputBytes: READ_MAX_OUTPUT_BYTES,
    },
  }
}
