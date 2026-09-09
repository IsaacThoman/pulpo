import { parseBuffer } from 'music-metadata'
import type { SpeechModel, SpeechRequest } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'
import { decodeSpeechBase64, mistralRequest } from './mistral.js'

const MAX_AUDIO_BYTES = 24 * 1024 * 1024
const fail = () => new AppError(502, 'speech_provider_error', 'Speech provider returned invalid audio or usage')
export interface SpeechUsage { input_tokens: number; output_tokens: number }
function requireTokenUsage(usage: SpeechUsage | undefined): asserts usage is SpeechUsage {
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) {
    throw new AppError(502, 'speech_usage_missing', 'Token billing requires valid provider-reported input text and output audio token usage')
  }
}
export async function generateSpeech(options: {
  baseUrl: string; apiKey: string; organizationId?: string | null; projectId?: string | null;
  model: SpeechModel; input: SpeechRequest; signal: AbortSignal; upstreamVoiceId?: string;
}, fetcher: typeof fetch = fetch) {
  const { model, input, signal } = options
  if (model.adapter === 'mistral') {
    const response = await mistralRequest(options, '/audio/speech', 'POST', {
      model: model.upstreamModelId, input: input.input, voice_id: options.upstreamVoiceId ?? input.voice,
      response_format: model.responseFormat, stream: false,
    }, fetcher)
    const audio = decodeSpeechBase64(response && typeof response === 'object' && 'audio_data' in response ? response.audio_data : undefined)
    return { audio, durationSeconds: await speechAudioDuration(audio, model.responseFormat), usage: undefined }
  }
  const response = await fetcher(`${options.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
    method: 'POST', signal, redirect: 'error',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}`,
      ...(options.organizationId ? { 'OpenAI-Organization': options.organizationId } : {}),
      ...(options.projectId ? { 'OpenAI-Project': options.projectId } : {}),
    },
    body: JSON.stringify({ model: model.upstreamModelId, input: input.input, voice: input.voice,
      ...(model.supportsInstructions && input.instructions ? { instructions: input.instructions } : {}),
      ...(model.supportsSpeed && input.speed !== undefined ? { speed: input.speed } : {}),
      response_format: model.responseFormat,
      ...(model.supportsSse ? { stream_format: 'sse' } : {}),
    }),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new AppError(response.status === 429 ? 429 : 502, 'speech_provider_error', response.status === 429 ? 'Speech is temporarily busy. Try again shortly.' : 'Speech generation failed')
  }
  if (!response.body) throw fail()
  const reader = response.body.getReader()
  const pieces: Buffer[] = []
  let size = 0, wireSize = 0, text = '', done = false
  let usage: SpeechUsage | undefined
  const append = (audio: Buffer) => { size += audio.length; if (size > MAX_AUDIO_BYTES) throw fail(); pieces.push(audio) }
  const decoder = new TextDecoder()
  const event = (frame: string) => {
    const payload = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!payload || payload === '[DONE]') return
    const value = JSON.parse(payload)
    if (value.type === 'speech.audio.delta' && !done && typeof value.audio === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value.audio)) append(Buffer.from(value.audio, 'base64'))
    else if (value.type === 'speech.audio.done' && !done) { done = true; usage = value.usage }
    else throw fail()
  }
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      wireSize += part.value.length
      if (wireSize > MAX_AUDIO_BYTES * 2) throw fail()
      if (!model.supportsSse) append(Buffer.from(part.value))
      else {
        text += decoder.decode(part.value, { stream: true })
        text = text.replace(/\r\n/g, '\n')
        let boundary: number
        while ((boundary = text.indexOf('\n\n')) !== -1) { event(text.slice(0, boundary)); text = text.slice(boundary + 2) }
      }
    }
    if (model.supportsSse) { text += decoder.decode(); if (text.trim()) event(text); if (!done) throw fail() }
    if (model.billUsers && model.billingUnit === 'tokens') requireTokenUsage(usage)
    const audio = Buffer.concat(pieces)
    if (!audio.length) throw fail()
    const durationSeconds = await speechAudioDuration(audio, model.responseFormat)
    return { audio, durationSeconds, usage }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export async function speechAudioDuration(audio: Buffer, format: 'mp3' | 'wav'): Promise<number> {
  try {
    const metadata = await parseBuffer(audio, { mimeType: format === 'mp3' ? 'audio/mpeg' : 'audio/wav' }, { duration: true })
    if (metadata.format.container !== (format === 'wav' ? 'WAVE' : 'MPEG')) throw fail()
    const duration = metadata.format.duration
    if (!duration || !Number.isFinite(duration) || duration <= 0 || duration > 1800) throw fail()
    return duration
  } catch { throw fail() }
}

export function speechCost(model: SpeechModel, input: string, durationSeconds: number, usage?: SpeechUsage): number {
  if (!model.billUsers) return 0
  let numerator: bigint, denominator: bigint
  if (model.billingUnit === 'tokens') {
    requireTokenUsage(usage)
    numerator = BigInt(usage.input_tokens) * BigInt(model.inputPriceMicros) + BigInt(usage.output_tokens) * BigInt(model.outputPriceMicros); denominator = 1_000_000n
  } else if (model.billingUnit === 'characters') {
    numerator = BigInt(Array.from(input).length) * BigInt(model.characterPriceMicros); denominator = 1000n
  } else {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw fail()
    numerator = BigInt(Math.ceil(durationSeconds * 1000)) * BigInt(model.minutePriceMicros); denominator = 60_000n
  }
  const result = Number((numerator + denominator - 1n) / denominator)
  if (!Number.isSafeInteger(result)) throw fail()
  return result
}
