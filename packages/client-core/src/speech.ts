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
/** `elapsed / total`, with `~` marking an estimated total. */
export function speechTimeLabel(progress: SpeechProgress | null) {
  const elapsed = speechClock(progress?.elapsed ?? 0)
  return progress?.total ? `${elapsed} / ${progress.estimated ? '~' : ''}${speechClock(progress.total)}` : elapsed
}
export function speechClock(value: number) {
  const total = Math.max(0, Math.floor(value))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
/** `ended` keeps a retained playback's audio after its natural end, for replay, until it is stopped. */
export type SpeechPlaybackState = { key: string | null; phase: 'idle' | 'loading' | 'playing' | 'ended'; paused: boolean; rate: number; error: string | null }
/**
 * `total` is exact once every chunk has been generated, and `estimated` from the speaking rate so far until then.
 * `buffered` is how far from the start audio has been generated, and so how far `seekTo` can reach.
 */
export type SpeechProgress = { elapsed: number; total: number | null; estimated: boolean; buffered: number; fraction: number }
type SpeechSession = {
  weights: number[]
  ready: SpeechAudio[]
  index: number
  audio?: SpeechAudio
  started: boolean
  interrupt?: AbortController
  jump?: { index: number; at: number }
  wake?: () => void
  ended: boolean
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
    if (!session || session.ended || this.state.paused) return
    if (session.started) session.audio?.pause?.()
    this.update({ paused: true })
  }
  resume = () => {
    const session = this.session
    if (session?.ended) { this.replay(); return }
    if (!session || !this.state.paused) return
    this.update({ paused: false })
    if (session.started) session.audio?.resume?.()
    else session.wake?.()
  }
  togglePause = () => { if (this.state.phase === 'ended') this.replay(); else if (this.state.paused) this.resume(); else this.pause() }
  /** Restarts from the beginning using audio already generated where possible. */
  replay = () => {
    const session = this.session
    if (!session) return
    if (this.state.paused) this.update({ paused: false })
    this.jump(session, 0, 0)
  }
  setRate = (rate: number) => { this.session?.audio?.setRate?.(rate); this.update({ rate }) }
  seekBy = (delta: number) => {
    const progress = this.progress()
    if (progress) this.seekTo(progress.elapsed + delta)
  }
  /**
   * Seeks to a time across the whole message. Chunks are generated in order, so a target past
   * the generated audio stops at the start of the next chunk still being generated.
   */
  seekTo = (target: number) => {
    const session = this.session
    if (!session) return
    let start = 0
    for (let index = 0; index < session.weights.length; index++) {
      const length = audioLength(session.ready[index])
      if (length === undefined) { this.moveTo(session, index, 0); return }
      if (target < start + length) { this.moveTo(session, index, Math.max(0, target - start)); return }
      start += length
    }
    if (session.weights.length) this.jump(session, session.weights.length, 0)
  }
  private moveTo(session: SpeechSession, index: number, at: number) {
    const audio = session.audio
    // A failed in-place seek leaves playback where it was.
    if (index === session.index && !session.ended && audio?.seek) void Promise.resolve(audio.seek(at)).catch(() => {})
    else this.jump(session, index, at)
  }
  progress = (): SpeechProgress | null => {
    const session = this.session
    if (!session) return null
    const position = session.audio?.currentTime?.() ?? 0
    const lengths = session.weights.map((_, index) => audioLength(session.ready[index]))
    const elapsed = sum(lengths.slice(0, session.index).map(length => length ?? 0)) + position
    // Until every chunk is generated, extrapolate the rest from the speaking rate heard so far.
    const knownSeconds = sum(lengths.map(length => length ?? 0))
    const knownCharacters = sum(session.weights.filter((_, index) => lengths[index] !== undefined))
    const firstMissing = lengths.findIndex(length => length === undefined)
    const buffered = sum(lengths.slice(0, firstMissing < 0 ? lengths.length : firstMissing) as number[])
    if (!knownSeconds || !knownCharacters) return { elapsed, total: null, estimated: false, buffered, fraction: 0 }
    const estimated = firstMissing >= 0
    const total = sum(lengths.map((length, index) => length ?? session.weights[index]! * knownSeconds / knownCharacters))
    return { elapsed, total, estimated, buffered, fraction: Math.min(1, elapsed / total) }
  }
  private jump(session: SpeechSession, index: number, at: number) {
    session.jump = { index, at }
    session.interrupt?.abort()
    session.wake?.()
  }
  /** With `retain`, playback that reaches its end stays in the `ended` phase with its audio, instead of stopping. */
  async start(key: string, chunks: string[] | ((signal: AbortSignal) => Promise<string[]>), generate: (input: string, signal: AbortSignal, offsetSeconds: number) => Promise<SpeechAudio>, { retain = false }: { retain?: boolean } = {}) {
    if (this.state.key === key) { this.stop(); return }
    this.stop()
    const active = new AbortController(); this.active = active
    const { signal } = active
    const session: SpeechSession = { weights: [], ready: [], index: 0, started: false, ended: false }
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
      while (!signal.aborted) {
        if (session.index >= list.length) {
          if (!retain) break
          session.ended = true
          this.update({ phase: 'ended', paused: false })
          await new Promise<void>(resolve => { session.wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }) })
          Object.assign(session, { wake: undefined, ended: false })
          const jump = session.jump; session.jump = undefined
          if (signal.aborted || !jump) break
          session.index = jump.index; startAt = jump.at
          continue
        }
        const index = session.index
        this.update({ phase: 'loading' })
        const result = await load(index)
        if ('error' in result) throw result.error
        if (signal.aborted) break
        // A seek made while this chunk was loading goes elsewhere first.
        if (session.jump) { ({ index: session.index, at: startAt } = session.jump); session.jump = undefined; continue }
        // Observe prefetch errors immediately, even while the current chunk plays.
        if (index + 1 < list.length) void load(index + 1)
        const { audio } = result
        const interrupt = new AbortController()
        const forward = () => interrupt.abort()
        signal.addEventListener('abort', forward, { once: true })
        Object.assign(session, { audio, interrupt, started: false })
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
        // Set by a seek while this chunk played; TypeScript cannot see that asynchronous write.
        const jump = session.jump as SpeechSession['jump']
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
