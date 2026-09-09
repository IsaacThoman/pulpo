import { describe, expect, it, vi } from 'vitest'
import { SPEECH_REQUEST_MAX_INPUT_LENGTH, speechRequestSchema } from '@pulpo/contracts'
import { SpeechPlayback, speechBytes, speechChunks, speechText, type SpeechAudio } from './speech.js'
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
