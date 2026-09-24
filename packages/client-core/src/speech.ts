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

export interface SpeechAudio {
  /** Generated speech duration reported by the server; keeps watermark phase across chunks. */
  durationSeconds?: number
  dispose(): void
  /** Resolves when the audio ends or `signal` aborts. Replays restart from the current position. */
  play(signal: AbortSignal): Promise<void>
  pause?(): void
  resume?(): void
  seek?(seconds: number): void | Promise<void>
  currentTime?(): number
  duration?(): number
  setRate?(rate: number): void
}
export const SPEECH_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const
export const SPEECH_SEEK_SECONDS = 10
export function nextSpeechRate(rate: number) {
  return SPEECH_PLAYBACK_RATES.find(candidate => candidate > rate) ?? SPEECH_PLAYBACK_RATES[0]
}
export function speechRateLabel(rate: number) {
  return `${rate}×`
}
export function speechClock(value: number) {
  const total = Math.max(0, Math.floor(value))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
export type SpeechPlaybackState = { key: string | null; phase: 'idle' | 'loading' | 'playing'; paused: boolean; rate: number; error: string | null }
/** `total` is known once every chunk has been generated; `fraction` is estimated from text length until then. */
export type SpeechProgress = { elapsed: number; total: number | null; fraction: number }
type SpeechSession = {
  weights: number[]
  ready: SpeechAudio[]
  index: number
  audio?: SpeechAudio
  started: boolean
  interrupt?: AbortController
  jump?: { index: number; at: number }
  wake?: () => void
}
const seconds = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
const audioLength = (audio: SpeechAudio | undefined) => seconds(audio?.duration?.()) ?? seconds(audio?.durationSeconds)
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

export class SpeechPlayback {
  private state: SpeechPlaybackState = { key: null, phase: 'idle', paused: false, rate: 1, error: null }
  private listeners = new Set<() => void>()
  private active?: AbortController
  private session?: SpeechSession
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.state
  private update(state: Partial<SpeechPlaybackState>) { this.state = { ...this.state, ...state }; for (const listener of this.listeners) listener() }
  stop = () => { this.active?.abort(); this.active = undefined; this.session = undefined; this.update({ key: null, phase: 'idle', paused: false, error: null }) }
  pause = () => {
    const session = this.session
    if (!session || this.state.paused) return
    if (session.started) session.audio?.pause?.()
    this.update({ paused: true })
  }
  resume = () => {
    const session = this.session
    if (!session || !this.state.paused) return
    this.update({ paused: false })
    if (session.started) session.audio?.resume?.()
    else session.wake?.()
  }
  togglePause = () => { if (this.state.paused) this.resume(); else this.pause() }
  setRate = (rate: number) => { this.session?.audio?.setRate?.(rate); this.update({ rate }) }
  /** Seeks within generated audio: backwards into earlier chunks, forwards at most into the next chunk. */
  seekBy = (delta: number) => {
    const session = this.session, audio = session?.audio
    if (!session || !audio?.seek) return
    // A failed in-place seek leaves playback where it was.
    const seek = (seconds: number) => { void Promise.resolve(audio.seek!(seconds)).catch(() => {}) }
    const target = (audio.currentTime?.() ?? 0) + delta
    if (target < 0) {
      const previous = session.ready[session.index - 1]
      if (!previous) { seek(0); return }
      this.jump(session, session.index - 1, Math.max(0, (audioLength(previous) ?? 0) + target))
      return
    }
    const length = audioLength(audio)
    if (length !== undefined && target >= length) this.jump(session, session.index + 1, 0)
    else seek(target)
  }
  progress = (): SpeechProgress | null => {
    const session = this.session
    if (!session) return null
    const position = session.audio?.currentTime?.() ?? 0
    const lengths = session.weights.map((_, index) => audioLength(session.ready[index]))
    const elapsed = sum(lengths.slice(0, session.index).map(length => length ?? 0)) + position
    const total = lengths.length && lengths.every(length => length !== undefined) ? sum(lengths as number[]) : null
    if (total) return { elapsed, total, fraction: Math.min(1, elapsed / total) }
    const weight = sum(session.weights)
    const current = lengths[session.index]
    const done = sum(session.weights.slice(0, session.index)) + (current ? Math.min(1, position / current) : 0) * (session.weights[session.index] ?? 0)
    return { elapsed, total, fraction: weight ? done / weight : 0 }
  }
  private jump(session: SpeechSession, index: number, at: number) {
    session.jump = { index, at }
    session.interrupt?.abort()
  }
  async start(key: string, chunks: string[] | ((signal: AbortSignal) => Promise<string[]>), generate: (input: string, signal: AbortSignal, offsetSeconds: number) => Promise<SpeechAudio>) {
    if (this.state.key === key) { this.stop(); return }
    this.stop()
    const active = new AbortController(); this.active = active
    const { signal } = active
    const session: SpeechSession = { weights: [], ready: [], index: 0, started: false }
    this.session = session
    this.update({ key, phase: 'loading', paused: false, error: null })
    const owned = new Set<SpeechAudio>(), played = new Set<SpeechAudio>()
    const loads: Array<Promise<{ audio: SpeechAudio } | { error: unknown }>> = []
    let list: string[] = []
    let offsetSeconds = 0
    // Chunks are generated strictly in order (one prefetched), so offsets follow the audio actually heard.
    const load = (index: number) => loads[index] ??= generate(list[index]!, signal, offsetSeconds).then(audio => {
      if (seconds(audio.durationSeconds)) offsetSeconds += audio.durationSeconds!
      if (signal.aborted) { audio.dispose(); throw new Error('Cancelled') }
      owned.add(audio); session.ready[index] = audio
      return { audio }
    }).catch((error: unknown) => ({ error }))
    try {
      list = typeof chunks === 'function' ? await chunks(signal) : chunks
      if (signal.aborted) return
      session.weights = list.map(chunk => chunk.length)
      let startAt = 0
      while (session.index < list.length && !signal.aborted) {
        const index = session.index
        this.update({ phase: 'loading' })
        const result = await load(index)
        if ('error' in result) throw result.error
        if (signal.aborted) break
        // Observe prefetch errors immediately, even while the current chunk plays.
        if (index + 1 < list.length) void load(index + 1)
        const { audio } = result
        const interrupt = new AbortController()
        const forward = () => interrupt.abort()
        signal.addEventListener('abort', forward, { once: true })
        Object.assign(session, { audio, interrupt, started: false, jump: undefined })
        audio.setRate?.(this.state.rate)
        if (startAt > 0 || played.has(audio)) await audio.seek?.(startAt)
        played.add(audio)
        this.update({ phase: 'playing' })
        if (this.state.paused && !interrupt.signal.aborted) await new Promise<void>(resolve => {
          session.wake = resolve
          interrupt.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        session.wake = undefined
        if (!interrupt.signal.aborted) { session.started = true; await audio.play(interrupt.signal) }
        signal.removeEventListener('abort', forward)
        const jump = session.jump
        Object.assign(session, { audio: undefined, interrupt: undefined, started: false, jump: undefined })
        if (signal.aborted) break
        session.index = jump?.index ?? index + 1
        startAt = jump?.at ?? 0
      }
      if (!signal.aborted) { this.session = undefined; this.update({ key: null, phase: 'idle', paused: false, error: null }) }
    } catch (error) {
      if (!signal.aborted) { this.session = undefined; this.update({ key: null, phase: 'idle', paused: false, error: error instanceof Error ? error.message : 'Speech playback failed' }) }
    } finally {
      active.abort()
      for (const audio of owned) audio.dispose()
      if (this.active === active) this.active = undefined
      if (this.session === session) this.session = undefined
    }
  }
}
