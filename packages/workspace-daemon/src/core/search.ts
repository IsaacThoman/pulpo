import { spawn } from 'node:child_process'
import { open, readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export type SearchType = 'find' | 'grep'

export interface SearchRequest {
  type: SearchType
  pattern: string
  /** Absolute directory (or file) to search. */
  path: string
  /** Directory that output paths are shown relative to. */
  cwd: string
  rgPath?: string
  maxOutputBytes?: number
  signal?: AbortSignal
}

export interface SearchResult {
  output: string
  exitCode: number | null
}

const DEFAULT_MAX_OUTPUT_BYTES = 10_000_000
const MAX_FILE_BYTES = 10 * 1024 * 1024
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.pulpo'])

function runRipgrep(request: SearchRequest, rgPath: string): Promise<SearchResult> {
  const args = request.type === 'find'
    ? ['--files', '--glob', request.pattern || '*', '--', request.path]
    : ['--line-number', '--no-heading', '--', request.pattern, request.path]
  const cap = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { cwd: request.cwd, windowsHide: true, signal: request.signal })
    const chunks: Buffer[] = []
    let bytes = 0
    const collect = (chunk: Buffer) => {
      if (bytes >= cap) return
      chunks.push(chunk)
      bytes += chunk.length
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', reject)
    child.once('close', (code) => resolve({ output: Buffer.concat(chunks).toString('utf8'), exitCode: code }))
  })
}

/** Translate a ripgrep-style glob (`*`, `**`, `?`, `{a,b}`) into a RegExp matched against forward-slash relative paths. */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  let index = 0
  let inGroup = false
  while (index < glob.length) {
    const character = glob[index]!
    if (character === '*') {
      if (glob[index + 1] === '*') {
        const followedBySlash = glob[index + 2] === '/'
        source += followedBySlash ? '(?:.*/)?' : '.*'
        index += followedBySlash ? 3 : 2
        continue
      }
      source += '[^/]*'
    } else if (character === '?') source += '[^/]'
    else if (character === '{') { inGroup = true; source += '(?:' }
    else if (character === '}' && inGroup) { inGroup = false; source += ')' }
    else if (character === ',' && inGroup) source += '|'
    else source += character.replace(/[.+^$()|[\]\\]/g, '\\$&')
    index += 1
  }
  const anchored = glob.includes('/') ? `^${source}$` : `(?:^|/)${source}$`
  return new RegExp(anchored)
}

async function isProbablyText(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const sample = Buffer.allocUnsafe(4_096)
    const { bytesRead } = await handle.read(sample, 0, sample.byteLength, 0)
    for (let index = 0; index < bytesRead; index += 1) if (sample[index] === 0) return false
    return true
  } finally {
    await handle.close()
  }
}

async function* walk(directory: string, signal?: AbortSignal): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    if (signal?.aborted) return
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      yield* walk(full, signal)
    } else if (entry.isFile()) yield full
  }
}

async function runFallback(request: SearchRequest): Promise<SearchResult> {
  const cap = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const lines: string[] = []
  let bytes = 0
  let matched = false
  const push = (line: string): boolean => {
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (bytes + size > cap) return false
    lines.push(line)
    bytes += size
    matched = true
    return true
  }
  const display = (file: string) => relative(request.cwd, file).split(sep).join('/')
  const metadata = await stat(request.path)
  const files = metadata.isFile() ? (async function* single() { yield request.path })() : walk(request.path, request.signal)

  if (request.type === 'find') {
    const matcher = globToRegExp(request.pattern || '*')
    for await (const file of files) {
      if (matcher.test(display(file))) { if (!push(display(file))) break }
    }
  } else {
    let matcher: RegExp
    try { matcher = new RegExp(request.pattern) } catch { matcher = new RegExp(request.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }
    for await (const file of files) {
      const info = await stat(file).catch(() => undefined)
      if (!info || info.size > MAX_FILE_BYTES) continue
      if (!await isProbablyText(file).catch(() => false)) continue
      const handle = await open(file, 'r')
      let stop = false
      try {
        const decoder = new TextDecoder('utf-8', { fatal: false })
        let remainder = ''
        let lineNumber = 0
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          const text = remainder + decoder.decode(chunk as Buffer, { stream: true })
          const parts = text.split(/\r?\n/)
          remainder = parts.pop() ?? ''
          for (const line of parts) {
            lineNumber += 1
            if (matcher.test(line) && !push(`${display(file)}:${lineNumber}:${line}`)) { stop = true; break }
          }
          if (stop) break
        }
        if (!stop && remainder) {
          lineNumber += 1
          if (matcher.test(remainder)) stop = !push(`${display(file)}:${lineNumber}:${remainder}`)
        }
      } finally {
        await handle.close()
      }
      if (stop) break
    }
  }
  return { output: lines.join('\n'), exitCode: matched ? 0 : 1 }
}

/** Search with ripgrep when a binary is available, otherwise with a pure-Node walker that mirrors rg's output format. */
export async function runSearch(request: SearchRequest): Promise<SearchResult> {
  if (request.rgPath) {
    try {
      return await runRipgrep(request, request.rgPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return runFallback(request)
}
