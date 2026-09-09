import { z } from 'zod'
import type { SpeechProviderVoice } from '@pulpo/contracts'
import { AppError } from '../lib/errors.js'

export interface SpeechConnection { baseUrl: string; apiKey: string; signal: AbortSignal; organizationId?: string | null; projectId?: string | null }
export const MAX_SPEECH_AUDIO_BYTES = 24 * 1024 * 1024
export function decodeSpeechBase64(value: unknown, maxBytes = MAX_SPEECH_AUDIO_BYTES): Buffer {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maxBytes / 3) * 4 || (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))) throw new AppError(502, 'speech_provider_error', 'Speech provider returned invalid audio')
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length > maxBytes) throw new AppError(502, 'speech_provider_error', 'Speech provider returned invalid audio')
  return bytes
}
export async function boundedJson(response: Response, maxBytes = MAX_SPEECH_AUDIO_BYTES * 2, raw = false): Promise<unknown> {
  if (!response.body) throw new AppError(502, 'speech_provider_error', 'Speech provider returned an empty response')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break
      size += part.value.length
      if (size > maxBytes) throw new Error('Response too large')
      chunks.push(part.value)
    }
    const bytes = Buffer.concat(chunks)
    return raw ? bytes : JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new AppError(502, 'speech_provider_error', 'Speech provider returned an invalid response')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export async function mistralRequest(connection: SpeechConnection, path: string, method = 'GET', body?: unknown, fetcher: typeof fetch = fetch, raw = false) {
  const response = await fetcher(`${connection.baseUrl.replace(/\/+$/, '')}${path}`, {
    method, signal: connection.signal, redirect: 'error',
    headers: { authorization: `Bearer ${connection.apiKey}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    await response.body?.cancel()
    const code = response.status === 404 ? 'speech_voice_missing' : 'speech_provider_error'
    const message = response.status === 404 ? 'The provider voice is unavailable. Ask an admin to repair or replace it.' : response.status === 429 ? 'Speech is temporarily busy. Try again shortly.' : response.status === 401 || response.status === 403 ? 'Check the speech provider API key and voice permissions.' : 'The speech provider could not complete this request.'
    throw new AppError(response.status === 429 ? 429 : 502, code, message)
  }
  if (method === 'DELETE' && response.status === 204) return null
  return boundedJson(response, raw ? 10 * 1024 * 1024 : MAX_SPEECH_AUDIO_BYTES * 2, raw)
}
const voiceSchema = z.object({ id: z.string().min(1).max(200), name: z.string().max(500), languages: z.array(z.string()).nullish(), user_id: z.string().nullable().optional(), slug: z.string().nullable().optional() })
export async function listMistralVoices(connection: SpeechConnection, fetcher: typeof fetch = fetch): Promise<SpeechProviderVoice[]> {
  const result = new Map<string, SpeechProviderVoice>()
  for (let offset = 0; offset < 10_000;) {
    const page = z.object({ items: z.array(voiceSchema), total: z.number().int().nonnegative() }).safeParse(await mistralRequest(connection, `/audio/voices?limit=100&offset=${offset}&type=all`, 'GET', undefined, fetcher))
    if (!page.success) throw new AppError(502, 'speech_provider_error', 'Speech provider returned an invalid voice catalog')
    for (const voice of page.data.items) result.set(voice.id, { id: voice.id, name: voice.name, languages: voice.languages ?? [], custom: Boolean(voice.user_id), ...(voice.slug ? { slug: voice.slug } : {}) })
    if (offset + page.data.items.length >= page.data.total) return [...result.values()]
    if (!page.data.items.length) break
    offset += page.data.items.length
  }
  throw new AppError(502, 'speech_provider_error', 'The provider voice catalog could not be loaded completely')
}
export async function createMistralVoice(connection: SpeechConnection, name: string, bytes: Buffer, slug: string): Promise<string> {
  const parsed = voiceSchema.safeParse(await mistralRequest(connection, '/audio/voices', 'POST', { name, sample_audio: bytes.toString('base64'), sample_filename: 'reference.wav', slug }))
  if (!parsed.success) throw new AppError(502, 'speech_provider_error', 'Speech provider returned an invalid voice')
  return parsed.data.id
}
export async function deleteMistralVoice(connection: SpeechConnection, id: string) {
  try { await mistralRequest(connection, `/audio/voices/${encodeURIComponent(id)}`, 'DELETE') }
  catch (error) { if (!(error instanceof AppError && error.code === 'speech_voice_missing')) throw error }
}
