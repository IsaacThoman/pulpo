import { apiRequest } from '../../api/client'

export type DictationSelection = { start: number; end: number }
export const MAX_DICTATION_DURATION_SECONDS = 60 * 60
export const DICTATION_AUDIO_BIT_RATE = 32_000
export const DICTATION_AUDIO_SAMPLE_RATE = 16_000

export function shouldApplyDictationResult(session: number, currentSession: number, aborted: boolean): boolean {
  return !aborted && session === currentSession
}

export function insertDictationText(
  current: string,
  transcript: string,
  selection: DictationSelection,
): { value: string; selection: DictationSelection } {
  const clean = transcript.trim()
  const start = Math.max(0, Math.min(selection.start, current.length))
  const end = Math.max(start, Math.min(selection.end, current.length))
  if (!clean) return { value: current, selection: { start, end: start } }

  const before = current.slice(0, start)
  const after = current.slice(end)
  const leadingSpace = before && !/\s$/.test(before) ? ' ' : ''
  const trailingSpace = after && !/^\s/.test(after) ? ' ' : ''
  const inserted = `${leadingSpace}${clean}${trailingSpace}`
  const cursor = before.length + inserted.length - trailingSpace.length
  return {
    value: before + inserted + after,
    selection: { start: cursor, end: cursor },
  }
}

export async function transcribeDictation(
  uri: string,
  signal?: AbortSignal,
): Promise<{ text: string }> {
  const form = new FormData()
  form.append('file', {
    uri,
    name: 'dictation.m4a',
    type: 'audio/mp4',
  } as unknown as Blob)
  return apiRequest('/api/dictation/transcriptions', {
    method: 'POST',
    body: form,
    signal,
    timeoutMs: 180_000,
  })
}
