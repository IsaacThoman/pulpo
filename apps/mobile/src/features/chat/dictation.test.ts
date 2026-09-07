import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictationController, MAX_DICTATION_BYTES } from './dictation'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function fixture() {
  const recorder = { prepare: vi.fn(async () => {}), record: vi.fn(), stop: vi.fn(async () => {}), release: vi.fn(), uri: 'file:///dictation.m4a', isRecording: true }
  const deps = {
    permission: vi.fn(async () => true), isForeground: vi.fn(() => true), audioMode: vi.fn(async () => {}), recorder: vi.fn(() => recorder),
    size: vi.fn(() => 1234), remove: vi.fn(), transcribe: vi.fn(async () => 'Hello world'),
  }
  const controller = new DictationController(deps)
  const apply = vi.fn()
  return { controller, recorder, deps, apply }
}
async function preparingSettled() { for (let i = 0; i < 10; i++) await Promise.resolve() }
afterEach(() => vi.useRealTimers())

describe('mobile dictation lifecycle', () => {
  it('records once, transcribes once, releases the microphone and deletes the file', async () => {
    const { controller, recorder, deps, apply } = fixture()
    const run = controller.start(apply)
    await controller.start(apply)
    await preparingSettled()
    expect(controller.getSnapshot().phase).toBe('recording')
    controller.stop(); controller.stop()
    await run
    expect(recorder.record).toHaveBeenCalledOnce()
    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(deps.transcribe).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith('Hello world')
    expect(recorder.release).toHaveBeenCalledOnce()
    expect(deps.remove).toHaveBeenCalledWith(recorder.uri)
    expect(deps.audioMode).toHaveBeenLastCalledWith(false)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', error: null })
  })
  it('denied permission never prepares or uploads audio and allows retry', async () => {
    const { controller, recorder, deps, apply } = fixture()
    deps.permission.mockResolvedValueOnce(false)
    await controller.start(apply)
    expect(controller.getSnapshot().error).toContain('Settings')
    expect(recorder.prepare).not.toHaveBeenCalled()
    expect(deps.transcribe).not.toHaveBeenCalled()
    const retry = controller.start(apply)
    await preparingSettled(); controller.stop(); await retry
    expect(apply).toHaveBeenCalledOnce()
  })
  it.each(['permission', 'prepare'] as const)('cancels during %s and waits for cleanup before another start', async (step) => {
    const { controller, recorder, deps, apply } = fixture()
    const gate = deferred<true>()
    if (step === 'permission') deps.permission.mockReturnValueOnce(gate.promise)
    else recorder.prepare.mockImplementationOnce(async () => { await gate.promise })
    const run = controller.start(apply)
    await preparingSettled(); controller.cancel()
    await controller.start(apply)
    expect(controller.busy).toBe(true)
    gate.resolve(true); await run
    expect(recorder.record).not.toHaveBeenCalled()
    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(controller.busy).toBe(false)
    if (step === 'prepare') expect(deps.remove).toHaveBeenCalledOnce()
  })
  it('cancels a recording without uploading it', async () => {
    const { controller, deps, apply } = fixture()
    const run = controller.start(apply)
    await preparingSettled(); controller.cancel(); await run
    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(deps.remove).toHaveBeenCalledOnce()
    expect(apply).not.toHaveBeenCalled()
  })
  it('aborts transcription and ignores a late response', async () => {
    const { controller, deps, apply } = fixture()
    const response = deferred<string>()
    deps.transcribe.mockReturnValueOnce(response.promise)
    const run = controller.start(apply)
    await preparingSettled(); controller.stop(); await preparingSettled()
    controller.cancel()
    expect((deps.transcribe.mock.calls[0] as unknown as [string, AbortSignal])[1].aborted).toBe(true)
    response.resolve('Too late'); await run
    expect(apply).not.toHaveBeenCalled()
    expect(deps.remove).toHaveBeenCalledOnce()
  })
  it('stops automatically at 90 seconds', async () => {
    vi.useFakeTimers()
    const { controller, deps, apply } = fixture()
    const run = controller.start(apply)
    await preparingSettled()
    await vi.advanceTimersByTimeAsync(89_000)
    expect(deps.transcribe).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000); await run
    expect(apply).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([0, MAX_DICTATION_BYTES + 1])('rejects invalid audio size %s before upload', async (size) => {
    const { controller, deps, apply } = fixture()
    deps.size.mockReturnValue(size)
    const run = controller.start(apply)
    await preparingSettled(); controller.stop(); await run
    expect(controller.getSnapshot().error).toBeTruthy()
    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(deps.remove).toHaveBeenCalledOnce()
  })
  it.each(['prepare', 'stop', 'transcribe'] as const)('recovers and cleans up after %s failure', async (step) => {
    const { controller, recorder, deps, apply } = fixture()
    const fn = step === 'transcribe' ? deps.transcribe : recorder[step]
    fn.mockRejectedValueOnce(new Error('Injected failure'))
    const run = controller.start(apply)
    await preparingSettled(); controller.stop(); await run
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', error: 'Injected failure' })
    expect(deps.remove).toHaveBeenCalledOnce()
    expect(recorder.release).toHaveBeenCalledOnce()
    expect(apply).not.toHaveBeenCalled()
  })
  it('never opens the microphone if permission or preparation finishes in the background', async () => {
    const { controller, recorder, deps, apply } = fixture()
    deps.isForeground.mockReturnValue(false)
    await controller.start(apply)
    expect(recorder.record).not.toHaveBeenCalled()
    expect(deps.remove).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().error).toContain('interrupted')
  })
  it('reports interrupted native recording and discards it', async () => {
    vi.useFakeTimers()
    const { controller, recorder, deps, apply } = fixture()
    const run = controller.start(apply)
    await preparingSettled(); recorder.isRecording = false
    await vi.advanceTimersByTimeAsync(250); await run
    expect(controller.getSnapshot().error).toContain('interrupted')
    expect(deps.transcribe).not.toHaveBeenCalled()
  })
})
