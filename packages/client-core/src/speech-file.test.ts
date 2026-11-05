import { describe, expect, it, vi } from 'vitest'
import { joinSpeechAudio, speechFileName } from './speech-file.js'
import { SpeechPlayback, type SpeechAudio } from './speech.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const text = (value: string) => new TextEncoder().encode(value)
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length } return out }
const u32 = (value: number) => { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return out }
const u16 = (value: number) => { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, value, true); return out }

function wav(samples: number[], { sampleRate = 24000, dataSize, extra = new Uint8Array() }: { sampleRate?: number; dataSize?: number; extra?: Uint8Array } = {}) {
  const data = new Uint8Array(new Int16Array(samples).buffer)
  const fmt = concat(u16(1), u16(1), u32(sampleRate), u32(sampleRate * 2), u16(2), u16(16))
  const body = concat(text('WAVE'), text('fmt '), u32(fmt.length), fmt, extra, text('data'), u32(dataSize ?? data.length), data)
  return concat(text('RIFF'), u32(body.length), body)
}
function readWav(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fmtSize = view.getUint32(16, true)
  const dataAt = 20 + fmtSize
  return {
    riff: new TextDecoder().decode(bytes.subarray(0, 4)), riffSize: view.getUint32(4, true),
    sampleRate: view.getUint32(24, true), data: new TextDecoder().decode(bytes.subarray(dataAt, dataAt + 4)),
    samples: Array.from(new Int16Array(bytes.slice(dataAt + 8, dataAt + 8 + view.getUint32(dataAt + 4, true)).buffer)),
  }
}

// An MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo frame: 417 bytes.
function mp3Frame(fill: number, tag?: 'Xing' | 'Info') {
  const frame = new Uint8Array(417).fill(fill)
  frame.set([0xff, 0xfb, 0x90, 0x00])
  if (tag) frame.set(text(tag), 4 + 32)
  return frame
}
const id3v2 = (size: number) => concat(text('ID3'), new Uint8Array([4, 0, 0, 0, 0, size >> 7 & 0x7f, size & 0x7f]), new Uint8Array(size).fill(9))
const id3v1 = () => concat(text('TAG'), new Uint8Array(125).fill(8))

describe('speech audio files', () => {
  it('joins WAV samples under one header', () => {
    const joined = joinSpeechAudio([wav([1, 2, 3]), wav([4, 5], { extra: concat(text('LIST'), u32(3), text('abc'), new Uint8Array(1)) })], 'wav')
    expect(readWav(joined)).toEqual({ riff: 'RIFF', riffSize: joined.length - 8, sampleRate: 24000, data: 'data', samples: [1, 2, 3, 4, 5] })
  })
  it('reads streamed WAV whose data size is unknown and drops partial sample frames', () => {
    const streamed = concat(wav([7, 8], { dataSize: 0xffffffff }), new Uint8Array([1]))
    expect(readWav(joinSpeechAudio([wav([6]), streamed, wav([9], { dataSize: 0 })], 'wav')).samples).toEqual([6, 7, 8, 9])
  })
  it('rejects WAV parts that are invalid or differ in format', () => {
    expect(() => joinSpeechAudio([wav([1]), wav([2], { sampleRate: 48000 })], 'wav')).toThrow('different formats')
    expect(() => joinSpeechAudio([text('nope')], 'wav')).toThrow('not valid WAV')
    expect(() => joinSpeechAudio([], 'mp3')).toThrow('no audio')
  })
  it('joins MP3 frames without tags or per-chunk Xing/Info headers', () => {
    const first = concat(id3v2(20), mp3Frame(1, 'Info'), mp3Frame(2), id3v1())
    const second = concat(mp3Frame(3, 'Xing'), mp3Frame(4))
    const third = mp3Frame(5)
    expect(joinSpeechAudio([first, second, third], 'mp3')).toEqual(concat(mp3Frame(2), mp3Frame(4), mp3Frame(5)))
  })
  it('names files from the start of the spoken text', () => {
    expect(speechFileName('Hello there: a/b "test"?\nNext line.', 'mp3')).toBe('Hello there a b test Next line.mp3')
    expect(speechFileName('word '.repeat(40), 'wav')).toBe(`${'word '.repeat(12).trim()}.wav`)
    expect(speechFileName('x'.repeat(100), 'mp3')).toBe(`${'x'.repeat(60)}.mp3`)
    expect(speechFileName('...', 'mp3')).toBe('Speech.mp3')
    expect(speechFileName('Ends with dots...', 'mp3')).toBe('Ends with dots.mp3')
  })
})

describe('saving playback audio', () => {
  function clip(samples: number[], { format = 'wav' as SpeechAudio['format'] } = {}) {
    return {
      dispose: vi.fn(), format, bytes: vi.fn(async () => wav(samples)),
      play: (signal: AbortSignal) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
    } satisfies SpeechAudio
  }

  it('generates the remaining chunks once, in order, and reuses them for playback', async () => {
    const player = new SpeechPlayback(); const clips = [clip([1]), clip([2]), clip([3])]
    const generate = vi.fn(async (input: string) => clips[Number(input.at(-1))]!)
    const run = player.start('m', ['Hello world 0', 'more 1', 'end 2'], generate, { retain: true })
    await tick()
    expect(generate).toHaveBeenCalledTimes(2)
    const file = await player.audioFile()
    expect(generate.mock.calls.map(([input]) => input)).toEqual(['Hello world 0', 'more 1', 'end 2'])
    expect(file).toMatchObject({ format: 'wav', mimeType: 'audio/wav', name: 'Hello world 0 more 1 end 2.wav' })
    expect(readWav(file.bytes).samples).toEqual([1, 2, 3])
    expect(player.getSnapshot()).toMatchObject({ key: 'm', phase: 'playing' })
    await player.audioFile(); expect(generate).toHaveBeenCalledTimes(3)
    player.stop(); await run
    for (const c of clips) expect(c.dispose).toHaveBeenCalledOnce()
  })
  it('fails while preparing, after stopping, on generation errors, and without encoded audio', async () => {
    const player = new SpeechPlayback()
    await expect(player.audioFile()).rejects.toThrow('still preparing')

    let fail: (error: Error) => void = () => {}
    const run = player.start('m', ['a', 'b', 'c'], vi.fn().mockResolvedValueOnce(clip([1])).mockResolvedValueOnce(clip([2])).mockReturnValueOnce(new Promise((_, reject) => { fail = reject })))
    await tick()
    const saving = player.audioFile()
    await tick(); fail(new Error('Speech generation failed'))
    await expect(saving).rejects.toThrow('Speech generation failed')
    player.stop(); await run

    const stopped = new SpeechPlayback()
    let finish: (audio: SpeechAudio) => void = () => {}
    const stoppedRun = stopped.start('m', ['a', 'b'], vi.fn().mockResolvedValueOnce(clip([1])).mockReturnValueOnce(new Promise(resolve => { finish = resolve })))
    await tick()
    const pending = stopped.audioFile()
    stopped.stop(); finish(clip([2]))
    await expect(pending).rejects.toThrow('Reading stopped')
    await stoppedRun

    const unsaveable = new SpeechPlayback()
    const { bytes: _, ...withoutBytes } = clip([1])
    const unsaveableRun = unsaveable.start('m', ['a'], async () => withoutBytes)
    await tick()
    await expect(unsaveable.audioFile()).rejects.toThrow('cannot be saved')
    unsaveable.stop(); await unsaveableRun
  })
})
