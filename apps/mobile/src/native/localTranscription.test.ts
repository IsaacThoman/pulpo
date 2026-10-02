import { describe, expect, it, vi } from 'vitest'

vi.mock('../../modules/pulpo-speech-transcriber', () => ({ default: null }))
import { createLocalTranscriber, localTranscriber } from './localTranscription'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function nativeModule(overrides: Partial<{ isAvailable: () => boolean; prepare: (language: string) => Promise<string>; transcribe: (uri: string, language: string) => Promise<string> }> = {}) {
  return {
    isAvailable: vi.fn(() => true),
    prepare: vi.fn(async (language: string) => language.replace('_', '-')),
    transcribe: vi.fn(async () => 'hello from the phone'),
    ...overrides,
  }
}
const signal = () => new AbortController().signal

describe('on-device transcription', () => {
  it('is unavailable without the native module or a supported device', () => {
    expect(localTranscriber()).toBeNull()
    expect(createLocalTranscriber(null)).toBeNull()
    expect(createLocalTranscriber(nativeModule({ isAvailable: () => false }) as never)).toBeNull()
    expect(createLocalTranscriber(nativeModule({ isAvailable: () => { throw new Error('boom') } }) as never)).toBeNull()
  })

  it('transcribes a recording with the locale the device supports', async () => {
    const native = nativeModule()
    const transcriber = createLocalTranscriber(native as never, () => 'en_US')!
    await expect(transcriber.transcribe('file:///clip.m4a', signal())).resolves.toBe('hello from the phone')
    expect(native.prepare).toHaveBeenCalledWith('en_US')
    expect(native.transcribe).toHaveBeenCalledWith('file:///clip.m4a', 'en-US')
  })

  it('warms the model up once and reuses it until the device language changes', async () => {
    const native = nativeModule()
    let language = 'en-US'
    const transcriber = createLocalTranscriber(native as never, () => language)!
    transcriber.warmUp()
    transcriber.warmUp()
    await transcriber.transcribe('file:///a.m4a', signal())
    expect(native.prepare).toHaveBeenCalledOnce()
    language = 'es-ES'
    await transcriber.transcribe('file:///b.m4a', signal())
    expect(native.prepare).toHaveBeenCalledTimes(2)
    expect(native.transcribe).toHaveBeenLastCalledWith('file:///b.m4a', 'es-ES')
  })

  it('overlaps a slow first-time model download with recording', async () => {
    const download = deferred<string>()
    const native = nativeModule({ prepare: vi.fn(() => download.promise) })
    const transcriber = createLocalTranscriber(native as never, () => 'en-US')!
    transcriber.warmUp()
    const result = transcriber.transcribe('file:///clip.m4a', signal())
    expect(native.transcribe).not.toHaveBeenCalled()
    download.resolve('en-US')
    await expect(result).resolves.toBe('hello from the phone')
  })

  it('retries preparation after a failure and explains unsupported languages', async () => {
    const native = nativeModule({
      prepare: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('On-device transcription does not support xx.'), { code: 'ERR_UNSUPPORTED_LOCALE' }))
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue('en-US'),
    })
    const transcriber = createLocalTranscriber(native as never, () => 'en-US')!
    transcriber.warmUp()
    await expect(transcriber.transcribe('file:///a.m4a', signal())).rejects.toThrow('does not support this device language')
    await expect(transcriber.transcribe('file:///a.m4a', signal())).rejects.toThrow('could not prepare its language model')
    await expect(transcriber.transcribe('file:///a.m4a', signal())).resolves.toBe('hello from the phone')
    expect(native.prepare).toHaveBeenCalledTimes(3)
  })

  it('reports transcription failures without leaking native details', async () => {
    const native = nativeModule({ transcribe: vi.fn().mockRejectedValue(new Error('SpeechAnalyzer error 7')) })
    const transcriber = createLocalTranscriber(native as never, () => 'en-US')!
    await expect(transcriber.transcribe('file:///a.m4a', signal())).rejects.toThrow('On-device transcription failed. Please try again.')
  })

  it('stops waiting when cancelled and ignores the late native result', async () => {
    const pending = deferred<string>()
    const native = nativeModule({ transcribe: vi.fn(() => pending.promise) })
    const transcriber = createLocalTranscriber(native as never, () => 'en-US')!
    const abort = new AbortController()
    const result = transcriber.transcribe('file:///a.m4a', abort.signal)
    await vi.waitFor(() => expect(native.transcribe).toHaveBeenCalled())
    abort.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    pending.resolve('too late')
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(transcriber.transcribe('file:///b.m4a', cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
