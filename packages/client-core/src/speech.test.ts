import { describe, expect, it, vi } from 'vitest'
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
