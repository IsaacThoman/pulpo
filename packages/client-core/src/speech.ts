import { Lexer, type Token } from 'marked'
import { SPEECH_REQUEST_MAX_INPUT_LENGTH, type PublicSpeechModel } from '@pulpo/contracts'

/** Only visible message markdown enters speech; callers never pass reasoning or tools. */
export function speechText(markdown: string): string {
  const walk = (tokens: Token[]): string => tokens.map(token => {
    if (['code', 'image', 'html', 'hr'].includes(token.type)) return ''
    if (token.type === 'list') return token.items.map((item: { tokens: Token[] }) => walk(item.tokens)).join('\n')
    if (token.type === 'table') return [token.header, ...token.rows].map(row => row.map((cell: { tokens: Token[] }) => walk(cell.tokens)).join(', ')).join('\n')
    if ('tokens' in token && token.tokens) return walk(token.tokens) + (['heading', 'paragraph', 'blockquote'].includes(token.type) ? '\n' : '')
    if (token.type === 'space' || token.type === 'br') return '\n'
    return 'text' in token ? token.text : ''
  }).join('')
  return walk(Lexer.lex(markdown)).replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function speechBytes(text: string): number {
  // A UTF-8 byte bound is a conservative token bound for byte-level tokenizers.
  return Array.from(text).reduce((n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0)
}
export function speechChunks(text: string, model: Pick<PublicSpeechModel, 'maxInputCharacters' | 'maxInputTokens'>, instructions = ''): string[] {
  const byteLimit = model.maxInputTokens === null ? Infinity : model.maxInputTokens - speechBytes(instructions)
  if (byteLimit < 1) throw new Error('Speech instructions are too long for this model')
  const result: string[] = []
  const characters = Array.from(text.trim())
  let offset = 0
  while (offset < characters.length) {
    let count = 0, bytes = 0, units = 0, boundary = 0
    while (offset + count < characters.length && count < model.maxInputCharacters) {
      const c = characters[offset + count]!
      const size = speechBytes(c)
      if (bytes + size > byteLimit || units + c.length > SPEECH_REQUEST_MAX_INPUT_LENGTH) break
      count++; bytes += size; units += c.length
      if (/[\s.!?。！？]/u.test(c)) boundary = count
    }
    if (!count) throw new Error('Speech input limit is too small for this text and its instructions')
    if (offset + count < characters.length && boundary > count / 2) count = boundary
    const chunk = characters.slice(offset, offset + count).join('').trim()
    if (chunk) result.push(chunk)
    offset += count
  }
  return result
}

export interface SpeechAudio { dispose(): void; play(signal: AbortSignal): Promise<void> }
export type SpeechPlaybackState = { key: string | null; phase: 'idle' | 'loading' | 'playing'; error: string | null }
export class SpeechPlayback {
  private state: SpeechPlaybackState = { key: null, phase: 'idle', error: null }
  private listeners = new Set<() => void>()
  private active?: AbortController
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.state
  private update(state: SpeechPlaybackState) { this.state = state; for (const listener of this.listeners) listener() }
  stop = () => { this.active?.abort(); this.active = undefined; this.update({ key: null, phase: 'idle', error: null }) }
  async start(key: string, chunks: string[] | ((signal: AbortSignal) => Promise<string[]>), generate: (input: string, signal: AbortSignal) => Promise<SpeechAudio>) {
    if (this.state.key === key) { this.stop(); return }
    this.stop()
    const active = new AbortController(); this.active = active
    const { signal } = active
    this.update({ key, phase: 'loading', error: null })
    const owned = new Set<SpeechAudio>()
    const prepare = async (text: string) => {
      const audio = await generate(text, signal)
      if (signal.aborted) { audio.dispose(); throw new Error('Cancelled') }
      owned.add(audio); return audio
    }
    try {
      chunks = typeof chunks === 'function' ? await chunks(signal) : chunks
      if (signal.aborted) return
      let next = chunks[0] ? prepare(chunks[0]) : undefined
      for (let index = 0; next && !signal.aborted; index++) {
        const audio = await next
        if (signal.aborted) break
        // Observe prefetch errors immediately, even while the preceding chunk plays.
        const pending = chunks[index + 1] ? prepare(chunks[index + 1]!).then(audio => ({ audio }), error => ({ error })) : undefined
        this.update({ key, phase: 'playing', error: null })
        await audio.play(signal)
        audio.dispose(); owned.delete(audio)
        if (signal.aborted) break
        this.update({ key, phase: 'loading', error: null })
        next = pending?.then(result => { if ('error' in result) throw result.error; return result.audio })
      }
      if (!signal.aborted) this.update({ key: null, phase: 'idle', error: null })
    } catch (error) {
      if (!signal.aborted) this.update({ key: null, phase: 'idle', error: error instanceof Error ? error.message : 'Speech playback failed' })
    } finally {
      active.abort()
      for (const audio of owned) audio.dispose()
      if (this.active === active) this.active = undefined
    }
  }
}
