import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBuffer } from 'music-metadata'
import { RECORDING_AUDIO_BITS_PER_SECOND, RECORDING_TAKE_MAX_SECONDS } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'

/** Conversions at once in this process; more wait their turn, up to a short queue. */
const MAX_ACTIVE = 2
const MAX_WAITING = 8
const TIMEOUT_MS = 120_000
let active = 0
const waiting: Array<() => void> = []

async function acquire(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  if (active < MAX_ACTIVE) active++
  else {
    if (waiting.length >= MAX_WAITING) throw new AppError(503, 'recording_audio_busy', 'Saving takes is busy right now. Try again shortly.')
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal.removeEventListener('abort', abort); resolve() }
      const abort = () => {
        const index = waiting.indexOf(ready)
        if (index >= 0) waiting.splice(index, 1)
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, { once: true })
      waiting.push(ready)
    })
  }
  return () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

class FfmpegMissingError extends Error {}

function runFfmpeg(args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', ...args], { stdio: 'ignore' })
    const abort = () => child.kill('SIGKILL')
    signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error: NodeJS.ErrnoException) => {
      signal.removeEventListener('abort', abort)
      reject(error.code === 'ENOENT' ? new FfmpegMissingError('ffmpeg is not installed') : error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else if (code === 0) resolve()
      else reject(new Error('Audio conversion failed'))
    })
  })
}

export interface NormalizedRecordingAudio {
  audio: Buffer
  mimeType: 'audio/mp4'
  durationMs: number
}

/**
 * Re-encodes a take as AAC in an MP4 file with its index up front, whatever the recorder made
 * (WebM from Chrome and Firefox, MP4 from Safari and phones). Every client can play and seek in
 * the result, and its length is measured rather than taken from the recorder. Null when ffmpeg
 * is not installed, so the take is kept as uploaded.
 */
export async function normalizeRecordingAudio(bytes: Uint8Array, signal = new AbortController().signal): Promise<NormalizedRecordingAudio | null> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
  const release = await acquire(bounded)
  let directory: string | undefined
  try {
    directory = await mkdtemp(join(tmpdir(), 'pulpo-recording-'))
    const source = join(directory, 'source')
    const output = join(directory, 'take.m4a')
    await writeFile(source, bytes, { mode: 0o600 })
    await runFfmpeg([
      // Decode by content, not by name, and only from the local file.
      '-protocol_whitelist', 'file', '-format_whitelist', 'matroska,mov,ogg,wav,mp3,aac',
      '-i', source, '-map', '0:a:0', '-vn', '-t', String(RECORDING_TAKE_MAX_SECONDS + 60),
      '-ac', '1', '-c:a', 'aac', '-b:a', String(RECORDING_AUDIO_BITS_PER_SECOND), '-movflags', '+faststart', '-f', 'mp4', output,
    ], bounded)
    const audio = await readFile(output)
    const metadata = await parseBuffer(audio, { mimeType: 'audio/mp4' }, { duration: true })
    const seconds = metadata.format.duration
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) throw new Error('The converted take has no length')
    return { audio, mimeType: 'audio/mp4', durationMs: Math.max(1, Math.round(seconds * 1000)) }
  } catch (error) {
    if (error instanceof FfmpegMissingError) return null
    if (signal.aborted) throw error
    if (bounded.aborted) throw new AppError(503, 'recording_audio_busy', 'Saving the take took too long. Try again.')
    throw new AppError(400, 'recording_audio_invalid', 'The take could not be read as audio')
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true })
    } finally {
      release()
    }
  }
}
