import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SPEECH_ASSET_MAX_BYTES } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { speechAudioDuration } from './provider.js'

const MAX_OUTPUT_BYTES = 24 * 1024 * 1024
let active = 0
const waiting: Array<() => void> = []
async function acquire(signal: AbortSignal) {
  signal.throwIfAborted()
  if (active >= 2) {
    if (waiting.length >= 16) throw new AppError(503, 'speech_audio_busy', 'Audio processing is busy. Try again shortly.')
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal.removeEventListener('abort', abort); resolve() }
      const abort = () => { const index = waiting.indexOf(ready); if (index >= 0) waiting.splice(index, 1); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true }); waiting.push(ready)
    })
  } else active++
  return () => { const next = waiting.shift(); if (next) next(); else active-- }
}
async function ffmpeg(args: string[], signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_complex_threads', '1', ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []; let size = 0, failure: Error | undefined
    const abort = () => { failure = new Error('Audio processing cancelled'); child.kill('SIGKILL') }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_OUTPUT_BYTES) { failure = new Error('Audio output exceeds its limit'); child.kill('SIGKILL') } else chunks.push(chunk) })
    child.on('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.on('close', code => { signal.removeEventListener('abort', abort); if (failure || code !== 0) reject(failure ?? new Error('Audio processing failed')); else resolve(Buffer.concat(chunks)) })
    if (signal.aborted) abort()
  })
}
async function withAudioFiles<T>(signal: AbortSignal, run: (directory: string, signal: AbortSignal) => Promise<T>): Promise<T> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
  const release = await acquire(bounded)
  let directory: string | undefined
  try { bounded.throwIfAborted(); directory = await mkdtemp(join(tmpdir(), 'pulpo-speech-')); return await run(directory, bounded) }
  finally { try { if (directory) await rm(directory, { recursive: true, force: true }) } finally { release() } }
}
const inputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3,wav,mov,aac,flac,ogg']
export async function normalizeSpeechAsset(bytes: Buffer, kind: 'clone' | 'watermark', signal: AbortSignal) {
  if (!bytes.length || bytes.length > SPEECH_ASSET_MAX_BYTES) throw new AppError(413, 'speech_asset_size', 'Choose a nonempty audio clip up to 10 MiB')
  try {
    return await withAudioFiles(signal, async (directory, bounded) => {
      const source = join(directory, 'source'); await writeFile(source, bytes, { mode: 0o600 })
      // Decode rather than trusting filenames, MIME types, or declared duration.
      const output = await ffmpeg([...inputOptions, '-i', source, '-map', '0:a:0', '-vn', '-t', '31', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], bounded)
      const durationSeconds = await speechAudioDuration(output, 'wav')
      if (durationSeconds > 30 || (kind === 'clone' && durationSeconds < 3)) throw new Error('Duration outside range')
      return { audio: output, durationSeconds, contentType: 'audio/wav' as const }
    })
  } catch (error) {
    if (signal.aborted || error instanceof AppError && error.statusCode === 503) throw error
    throw new AppError(400, 'speech_asset_invalid', kind === 'clone' ? 'Choose valid MP3, WAV, M4A/AAC, FLAC or Ogg/Opus audio lasting 3–30 seconds. FFmpeg must be installed on the server.' : 'Choose valid MP3, WAV, M4A/AAC, FLAC or Ogg/Opus audio up to 30 seconds. FFmpeg must be installed on the server.')
  }
}
export async function mixSpeechWatermark(audio: Buffer, watermark: Buffer, options: { format: 'mp3' | 'wav'; volume: number; offsetSeconds: number; signal: AbortSignal }) {
  try {
    const durationSeconds = await speechAudioDuration(audio, options.format)
    const watermarkDuration = await speechAudioDuration(watermark, 'wav')
    const offset = options.offsetSeconds % watermarkDuration
    if (!Number.isFinite(offset) || options.volume < 0.01 || options.volume > 1) throw new Error('Invalid mix settings')
    const mixed = await withAudioFiles(options.signal, async (directory, bounded) => {
      const speechPath = join(directory, 'speech'); const watermarkPath = join(directory, 'watermark.wav')
      await writeFile(speechPath, audio, { mode: 0o600 }); await writeFile(watermarkPath, watermark, { mode: 0o600 })
      return ffmpeg([...inputOptions, '-i', speechPath, '-stream_loop', '-1', ...inputOptions, '-i', watermarkPath,
        '-filter_complex', `[1:a]atrim=start=${offset},asetpts=PTS-STARTPTS,volume=${options.volume}[mark];[0:a][mark]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=false:latency=true[out]`,
        '-map', '[out]', '-t', String(durationSeconds), '-ar', '24000', '-ac', '1', '-c:a', options.format === 'wav' ? 'pcm_s16le' : 'libmp3lame',
        ...(options.format === 'mp3' ? ['-b:a', '128k'] : []), '-f', options.format, 'pipe:1'], bounded)
    })
    await speechAudioDuration(mixed, options.format)
    return mixed
  } catch (error) {
    if (options.signal.aborted) throw error
    throw new AppError(502, 'speech_watermark_failed', 'The voice watermark could not be applied. Ask an admin to check its clip and the server audio setup.')
  }
}
