import { describe, expect, it, vi } from 'vitest'
import { SPEECH_REQUEST_MAX_INPUT_LENGTH, speechRequestSchema } from '@pulpo/contracts'
import { SpeechPlayback, nextSpeechRate, speechBytes, speechChunks, speechClock, speechRateLabel, speechText, speechTimeLabel, type SpeechAudio } from './speech.js'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

describe('speech text', () => {
  it('reads visible prose, lists, tables and inline code without code blocks or destinations', () => {
    const text = speechText('# Heading\n\n- **Hello** [world](https://secret.example)\n- Use `value`\n\n| A | B |\n|---|---|\n| one | two |\n\n```js\nsecret()\n```\n\nhttps://example.org ![image](https://image.org)')
    expect(text).toContain('Heading'); expect(text).toContain('Hello world'); expect(text).toContain('Use value'); expect(text).toContain('one, two')
    expect(text).not.toMatch(/https|secret|image|```/)
  })
  it('does not read HTML or code-only messages', () => {
    expect(speechText('```\ncode\n```')).toBe('')
    expect(speechText('<script>hidden()</script>')).toBe('')
  })
  it('keeps Unicode intact and respects character and conservative token limits', () => {
    const input = 'Hello 👋 世界. '.repeat(20).trim()
    const chunks = speechChunks(input, { maxInputCharacters: 40, maxInputTokens: 35 }, 'calm')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ').replace(/\s/g, '')).toBe(input.replace(/\s/g, ''))
    for (const chunk of chunks) { expect(Array.from(chunk).length).toBeLessThanOrEqual(40); expect(speechBytes(chunk) + 4).toBeLessThanOrEqual(35); expect(chunk).not.toContain('\ufffd') }
    expect(() => speechChunks('Hello', { maxInputCharacters: 40, maxInputTokens: 4 }, 'long')).toThrow()
  })
  it.each(['x', '👋', '界', '\u0001'])('keeps large %s chunks within the request schema without losing text', character => {
    const input = character.repeat(40_000)
    const chunks = speechChunks(input, { maxInputCharacters: 100_000, maxInputTokens: null })
    expect(chunks.join('')).toBe(input)
    expect(chunks[0]!.length).toBe(SPEECH_REQUEST_MAX_INPUT_LENGTH)
    for (const chunk of chunks) {
      expect(chunk).not.toContain('\ufffd')
      expect(speechRequestSchema.safeParse({ requestId: '22222222-2222-4222-8222-222222222222', modelId: 'speech', voice: 'coral', input: chunk }).success).toBe(true)
    }
  })
  it('uses larger provider limits and small remaining token budgets', () => {
    expect(speechChunks('x'.repeat(10_000), { maxInputCharacters: 8192, maxInputTokens: null }).map(chunk => chunk.length)).toEqual([8192, 1808])
    expect(speechChunks('abc', { maxInputCharacters: 1, maxInputTokens: 5 }, 'calm')).toEqual(['a', 'b', 'c'])
    expect(speechChunks('世界', { maxInputCharacters: 10, maxInputTokens: 7 }, 'calm')).toEqual(['世', '界'])
    expect(() => speechChunks('👋', { maxInputCharacters: 10, maxInputTokens: 7 }, 'calm')).toThrow('too small')
  })
})
describe('speech playback', () => {
  it('starts after one chunk, prefetches only the next, and disposes every audio', async () => {
    const player = new SpeechPlayback(); const finished = deferred<void>()
    const audio = [0, 1, 2].map(index => ({ dispose: vi.fn(), play: vi.fn(() => index === 0 ? finished.promise : Promise.resolve()) }))
    let i = 0; const generate = vi.fn(async () => audio[i++]!)
    const run = player.start('m', ['a', 'b', 'c'], generate)
    await tick(); expect(generate).toHaveBeenCalledTimes(2); expect(audio[0]!.play).toHaveBeenCalledOnce(); expect(audio[1]!.play).not.toHaveBeenCalled()
    finished.resolve(); await run
    expect(generate).toHaveBeenCalledTimes(3); for (const a of audio) expect(a.dispose).toHaveBeenCalledOnce()
    expect(player.getSnapshot().phase).toBe('idle')
  })
  it('discards a late prefetched result after stop', async () => {
    const player = new SpeechPlayback(); const late = deferred<SpeechAudio>()
    const first = { dispose: vi.fn(), play: (signal: AbortSignal) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })) }
    const second = { dispose: vi.fn(), play: vi.fn(async () => {}) }
    const generate = vi.fn().mockResolvedValueOnce(first).mockReturnValueOnce(late.promise)
    const run = player.start('m', ['a', 'b'], generate)
    await tick(); player.stop(); await run; late.resolve(second); await tick()
    expect(first.dispose).toHaveBeenCalledOnce(); expect(second.dispose).toHaveBeenCalledOnce(); expect(second.play).not.toHaveBeenCalled()
  })
  it('cancels asynchronous preparation and never starts stale audio', async () => {
    const player = new SpeechPlayback(); const prepared = deferred<string[]>()
    const generate = vi.fn()
    const run = player.start('m', () => prepared.promise, generate)
    expect(player.getSnapshot().phase).toBe('loading'); player.stop(); prepared.resolve(['a']); await run
    expect(generate).not.toHaveBeenCalled(); expect(player.getSnapshot().phase).toBe('idle')
  })
  it('surfaces generation and playback errors and disposes prefetched audio', async () => {
    const player = new SpeechPlayback()
    await player.start('m', ['a'], async () => { throw new Error('provider failed') })
    expect(player.getSnapshot().error).toBe('provider failed')
    const audio = { dispose: vi.fn(), play: async () => { throw new Error('autoplay blocked') } }
    await player.start('m', ['a'], async () => audio)
    expect(player.getSnapshot().error).toBe('autoplay blocked'); expect(audio.dispose).toHaveBeenCalledOnce()
  })
})

it('carries generated duration through prefetch to keep watermark phase across chunks', async () => {
  const player = new SpeechPlayback(); const offsets: number[] = []; const durations = [1.25, 2, 0.5]
  await player.start('voice', ['a', 'b', 'c'], async (_, _signal, offset) => {
    offsets.push(offset)
    return { durationSeconds: durations[offsets.length - 1], dispose() {}, play: async () => {} }
  })
  expect(offsets).toEqual([0, 1.25, 3.25])
  offsets.length = 0
  await player.start('legacy', ['a', 'b'], async (_, _signal, offset) => { offsets.push(offset); return { dispose() {}, play: async () => {} } })
  expect(offsets).toEqual([0, 0])
})

describe('speech playback controls', () => {
  // A controllable clip: time only moves when the test sets it, and it ends when finish() is called.
  function clip(length: number) {
    let finish = () => {}
    const audio = {
      time: 0, rate: 1, playing: false, plays: 0,
      dispose: vi.fn(),
      play: vi.fn((signal: AbortSignal) => new Promise<void>(resolve => {
        audio.plays++; audio.playing = true
        finish = () => { audio.playing = false; resolve() }
        signal.addEventListener('abort', () => { audio.playing = false; resolve() }, { once: true })
      })),
      pause: vi.fn(() => { audio.playing = false }),
      resume: vi.fn(() => { audio.playing = true }),
      seek: vi.fn((seconds: number) => { audio.time = seconds }),
      currentTime: () => audio.time,
      duration: () => length,
      setRate: vi.fn((rate: number) => { audio.rate = rate }),
      finish: () => finish(),
    }
    return audio
  }
  const setup = (lengths: number[]) => {
    const player = new SpeechPlayback(); const clips = lengths.map(clip)
    let i = 0; const generate = vi.fn(async () => clips[i++]!)
    const run = player.start('m', lengths.map((_, index) => 'x'.repeat(10 + index)), generate)
    return { player, clips, generate, run }
  }

  it('pauses and resumes the current clip', async () => {
    const { player, clips: [a], run } = setup([5])
    await tick(); expect(a!.playing).toBe(true)
    player.togglePause(); expect(player.getSnapshot().paused).toBe(true); expect(a!.pause).toHaveBeenCalledOnce()
    player.togglePause(); expect(player.getSnapshot().paused).toBe(false); expect(a!.resume).toHaveBeenCalledOnce()
    a!.finish(); await run
    expect(player.getSnapshot()).toMatchObject({ key: null, phase: 'idle', paused: false })
  })

  it('stays paused across a chunk boundary until resumed', async () => {
    const { player, clips: [a, b], run } = setup([5, 5])
    await tick(); player.pause(); a!.finish(); await tick()
    expect(player.getSnapshot()).toMatchObject({ phase: 'playing', paused: true }); expect(b!.play).not.toHaveBeenCalled()
    player.resume(); await tick(); expect(b!.play).toHaveBeenCalledOnce()
    b!.finish(); await run
  })

  it('seeks within a clip, back into the previous clip without regenerating, and forward into the next', async () => {
    const { player, clips: [a, b], generate, run } = setup([20, 30])
    await tick(); a!.time = 12
    player.seekBy(-10); expect(a!.time).toBe(2)
    player.seekBy(10); expect(a!.time).toBe(12)
    player.seekBy(10); await tick(); await tick()
    expect(b!.play).toHaveBeenCalledOnce(); expect(b!.time).toBe(2)
    b!.time = 4; player.seekBy(-10); await tick(); await tick()
    expect(a!.plays).toBe(2); expect(a!.time).toBe(14); expect(generate).toHaveBeenCalledTimes(2)
    expect(player.progress()).toMatchObject({ elapsed: 14, total: 50 })
    a!.finish(); await tick(); await tick(); expect(b!.plays).toBe(2); expect(b!.time).toBe(0)
    b!.finish(); await run
  })

  it('keeps retained audio after the end for replay and seeking back, without regenerating', async () => {
    const player = new SpeechPlayback(); const clips = [clip(5), clip(7)]
    let i = 0; const generate = vi.fn(async () => clips[i++]!)
    const run = player.start('m', ['a', 'b'], generate, { retain: true })
    await tick(); clips[0]!.finish(); await tick(); await tick(); clips[1]!.finish(); await tick()
    expect(player.getSnapshot()).toMatchObject({ key: 'm', phase: 'ended', paused: false })
    expect(player.progress()).toMatchObject({ elapsed: 12, total: 12, fraction: 1 })
    player.pause(); expect(player.getSnapshot().paused).toBe(false)
    player.seekBy(-3); await tick(); await tick()
    expect(player.getSnapshot().phase).toBe('playing'); expect(clips[1]!.plays).toBe(2); expect(clips[1]!.time).toBe(4)
    clips[1]!.finish(); await tick(); expect(player.getSnapshot().phase).toBe('ended')
    player.togglePause(); await tick(); await tick()
    expect(clips[0]!.plays).toBe(2); expect(clips[0]!.time).toBe(0); expect(generate).toHaveBeenCalledTimes(2)
    player.stop(); await run
    expect(player.getSnapshot()).toMatchObject({ key: null, phase: 'idle' }); for (const c of clips) expect(c.dispose).toHaveBeenCalledOnce()
  })

  it('replays from the start mid-playback and lets media play restart an ended playback', async () => {
    const player = new SpeechPlayback(); const clips = [clip(5)]
    const run = player.start('m', ['a'], async () => clips[0]!, { retain: true })
    await tick(); clips[0]!.time = 3; player.replay(); await tick(); await tick()
    expect(clips[0]!.plays).toBe(2); expect(clips[0]!.time).toBe(0)
    clips[0]!.finish(); await tick(); expect(player.getSnapshot().phase).toBe('ended')
    player.resume(); await tick(); await tick(); expect(clips[0]!.plays).toBe(3)
    player.stop(); await run
  })

  it('scrubs across clips and stops at the start of a clip still being generated', async () => {
    const player = new SpeechPlayback(); const a = clip(10), b = clip(20), c = clip(30); const third = deferred<SpeechAudio>()
    const generate = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockReturnValueOnce(third.promise)
    const run = player.start('m', ['x'.repeat(10), 'x'.repeat(20), 'x'.repeat(30)], generate)
    await tick(); await tick()
    expect(player.progress()).toMatchObject({ buffered: 30, total: 60, estimated: true })
    player.seekTo(4); expect(a.time).toBe(4)
    player.seekTo(25); await tick(); await tick(); expect(b.plays).toBe(1); expect(b.time).toBe(15)
    player.seekTo(55); await tick(); await tick()
    expect(player.getSnapshot().phase).toBe('loading'); expect(c.play).not.toHaveBeenCalled()
    player.seekTo(3); third.resolve(c); await tick(); await tick()
    expect(c.play).not.toHaveBeenCalled(); expect(a.plays).toBe(2); expect(a.time).toBe(3)
    expect(player.progress()).toMatchObject({ elapsed: 3, total: 60, estimated: false, buffered: 60 })
    player.stop(); await run
  })

  it('ends playback when seeking past the final clip', async () => {
    const { player, clips: [a], run } = setup([8])
    await tick(); a!.time = 5; player.seekBy(10); await run
    expect(player.getSnapshot()).toMatchObject({ key: null, phase: 'idle' })
  })

  it('applies the playback rate to the current and later clips and keeps it after stopping', async () => {
    const { player, clips: [a, b], run } = setup([5, 5])
    await tick(); player.setRate(1.5); expect(a!.rate).toBe(1.5)
    a!.finish(); await tick(); await tick(); expect(b!.rate).toBe(1.5)
    player.stop(); await run
    expect(player.getSnapshot().rate).toBe(1.5)
  })

  it('estimates the total from the speaking rate until every clip is generated', async () => {
    const player = new SpeechPlayback(); const a = clip(10); const pending = deferred<SpeechAudio>()
    const generate = vi.fn().mockResolvedValueOnce(a).mockReturnValueOnce(pending.promise)
    const run = player.start('m', ['x'.repeat(10), 'x'.repeat(30)], generate)
    await tick(); a.time = 5
    expect(player.progress()).toEqual({ elapsed: 5, total: 40, estimated: true, buffered: 10, fraction: 5 / 40 })
    expect(speechTimeLabel(player.progress())).toBe('0:05 / ~0:40')
    player.stop(); await run; pending.resolve(clip(1))
    expect(player.progress()).toBeNull()
  })
})

it('formats playback time and cycles playback rates', () => {
  expect([0, 9.9, 61, 3600].map(speechClock)).toEqual(['0:00', '0:09', '1:01', '60:00'])
  expect([0.75, 1, 1.25, 1.5, 2, 1.1].map(nextSpeechRate)).toEqual([1, 1.25, 1.5, 2, 0.75, 1.25])
  expect(speechRateLabel(1.25)).toBe('1.25×')
})
