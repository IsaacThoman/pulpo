import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'

export interface CliIo {
  stdin: NodeJS.ReadStream
  stdout: Writable
  stderr: Writable
}

export const processIo: CliIo = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }

function scalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function tableRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map((item) => item && typeof item === 'object' ? item as Record<string, unknown> : { value: item })
  if (value && typeof value === 'object') return [value as Record<string, unknown>]
  return [{ value }]
}

export function writeOutput(io: CliIo, value: unknown, json: boolean): void {
  if (json) {
    io.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    return
  }
  const rows = tableRows(value)
  if (!rows.length) return
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    .filter((column) => rows.some((row) => row[column] !== undefined))
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => scalar(row[column]).length)))
  io.stdout.write(`${columns.map((column, index) => column.padEnd(widths[index]!)).join('  ')}\n`)
  io.stdout.write(`${widths.map((width) => '-'.repeat(width)).join('  ')}\n`)
  for (const row of rows) io.stdout.write(`${columns.map((column, index) => scalar(row[column]).padEnd(widths[index]!)).join('  ')}\n`)
}

export function writeError(io: CliIo, message: string, json = false, code = 'cli_error'): void {
  io.stderr.write(json ? `${JSON.stringify({ error: { code, message } })}\n` : `Error: ${message}\n`)
}

export async function readSecret(io: CliIo, prompt: string): Promise<string> {
  if (!io.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of io.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8').trimEnd()
  }
  io.stderr.write(prompt)
  const input = io.stdin
  input.setRawMode?.(true)
  input.resume()
  return new Promise<string>((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      input.off('data', onData)
      input.setRawMode?.(false)
      input.pause()
      io.stderr.write('\n')
    }
    const onData = (chunk: Buffer | string) => {
      const text = String(chunk)
      for (const character of text) {
        if (character === '\u0003') { cleanup(); reject(new Error('Cancelled')); return }
        if (character === '\r' || character === '\n') { cleanup(); resolve(value); return }
        if (character === '\u007f') value = value.slice(0, -1)
        else value += character
      }
    }
    input.on('data', onData)
  })
}

export async function confirmExact(io: CliIo, expected: string, yes: boolean, json: boolean): Promise<void> {
  if (yes) return
  if (json || !io.stdin.isTTY) throw new Error('Confirmation required; rerun with --yes in noninteractive mode')
  const readline = createInterface({ input: io.stdin as unknown as Readable, output: io.stderr })
  try {
    const answer = await readline.question(`Type ${expected} to confirm: `)
    if (answer !== expected) throw new Error('Confirmation did not match; no changes were made')
  } finally {
    readline.close()
  }
}
