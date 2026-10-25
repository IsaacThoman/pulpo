// @vitest-environment node
import { RECORDING_TAKE_MAX_SECONDS } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordedTake } from '../api'
import { MIN_TAKE_MS, TakeRecorderController, type NativeTakeRecorder, type TakeRecorderDependencies } from './recorder'

/** A recorder whose clock advances with the fake timers while it records. */
class FakeRecorder implements NativeTakeRecorder {
  recording = false
  durationMillis = 0
  metering: number | undefined = -20
  stopped = false
  released = false
  constructor(readonly uri: string) {}
  prepare = vi.fn(async () => {})
  record() { this.recording = true }
  pause() { this.recording = false }
  async stop() { this.recording = false; this.stopped = true }
  release() { this.released = true }
  status() { return { isRecording: this.recording, durationMillis: this.durationMillis, metering: this.metering } }
  advance(ms: number) { if (this.recording) this.durationMillis += ms }
}

describe('TakeRecorderController', () => {
  let recorders: FakeRecorder[]
  let deps: TakeRecorderDependencies & { removed: string[]; awake: boolean[]; modes: boolean[] }
  let takes: RecordedTake[]
  let controller: TakeRecorderController
  const run = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 80) {
      for (const recorder of recorders) recorder.advance(80)
      await vi.advanceTimersByTimeAsync(80)
    }
  }
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T14:00:00.000Z'))
    recorders = []
    takes = []
    deps = {
      removed: [], awake: [], modes: [],
      permission: vi.fn(async () => true),
      audioMode: vi.fn(async (recording: boolean) => { deps.modes.push(recording) }),
      recorder: () => {
        const recorder = new FakeRecorder(`file:///take-${recorders.length}.m4a`)
        recorders.push(recorder)
        return recorder
      },
      remove: (uri) => { deps.removed.push(uri) },
      keepAwake: (awake) => { deps.awake.push(awake) },
    }
    controller = new TakeRecorderController(deps)
  })
  afterEach(() => { vi.useRealTimers() })

  it('records a take with its waveform and hands it over on stop', async () => {
    await controller.start((take) => takes.push(take))
    expect(controller.getSnapshot().phase).toBe('recording')
    expect(deps.awake).toEqual([true])
    await run(1_600)
    expect(controller.getSnapshot().elapsedMs).toBe(1_000)
    expect(controller.getLevels().at(-1)).toBeGreaterThan(0)
    await controller.stop()
    expect(takes).toHaveLength(1)
    expect(takes[0]).toMatchObject({ uri: 'file:///take-0.m4a', recordedAt: '2026-10-25T14:00:00.000Z' })
    expect(takes[0]!.durationMs).toBe(1_600)
    expect(takes[0]!.levels).toHaveLength(16)
    expect(takes[0]!.levels.every((level) => level > 0 && level <= 100)).toBe(true)
    expect(recorders[0]).toMatchObject({ stopped: true, released: true })
    expect(controller.getSnapshot().phase).toBe('idle')
    expect(deps.awake).toEqual([true, false])
    expect(deps.modes).toEqual([true, false])
    expect(deps.removed).toEqual([])
  })

  it('leaves time paused out of the take', async () => {
    await controller.start((take) => takes.push(take))
    await run(800)
    controller.pause()
    expect(controller.getSnapshot().phase).toBe('paused')
    await run(2_000)
    controller.resume()
    await run(800)
    await controller.stop()
    expect(takes[0]!.durationMs).toBe(1_600)
  })

  it('drops a take too short to be anything but a mistap', async () => {
    await controller.start((take) => takes.push(take))
    await run(MIN_TAKE_MS - 100)
    await controller.stop()
    expect(takes).toEqual([])
    expect(deps.removed).toEqual(['file:///take-0.m4a'])
  })

  it('throws the take away when cancelled', async () => {
    await controller.start((take) => takes.push(take))
    await run(2_000)
    controller.cancel()
    await settle()
    expect(takes).toEqual([])
    expect(deps.removed).toEqual(['file:///take-0.m4a'])
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', elapsedMs: 0 })
  })

  it('carries on in a new take at the take limit', async () => {
    await controller.start((take) => takes.push(take))
    recorders[0]!.durationMillis = RECORDING_TAKE_MAX_SECONDS * 1000 - 40
    await run(160)
    await settle()
    expect(takes).toHaveLength(1)
    expect(recorders).toHaveLength(2)
    expect(recorders[1]!.recording).toBe(true)
    expect(controller.getSnapshot().phase).toBe('recording')
    await run(1_000)
    expect(controller.getSnapshot().elapsedMs).toBeGreaterThanOrEqual(RECORDING_TAKE_MAX_SECONDS * 1000)
    await controller.stop()
    expect(takes).toHaveLength(2)
    expect(takes[1]!.uri).toBe('file:///take-1.m4a')
  })

  it('pauses when the system takes the microphone, keeping the take open', async () => {
    await controller.start((take) => takes.push(take))
    await run(1_000)
    recorders[0]!.recording = false
    await run(160)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'paused', error: expect.stringContaining('another app') })
    controller.resume()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'recording', error: null })
    await controller.stop()
    expect(takes).toHaveLength(1)
  })

  it('reports a denied microphone without opening one', async () => {
    deps.permission = vi.fn(async () => false)
    controller = new TakeRecorderController(deps)
    await controller.start((take) => takes.push(take))
    expect(recorders).toHaveLength(0)
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', error: expect.stringContaining('Microphone access is denied') })
  })

  it('explains a microphone that fails to open in plain words', async () => {
    deps.recorder = () => {
      const recorder = new FakeRecorder(`file:///take-${recorders.length + 1}.m4a`)
      recorder.prepare = vi.fn(async () => { throw new Error("FunctionCallException: Calling the 'prepareToRecordAsync' function has failed") })
      recorders.push(recorder)
      return recorder
    }
    controller = new TakeRecorderController(deps)
    await controller.start((take) => takes.push(take))
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', error: expect.stringContaining('The microphone couldn’t start') })
    expect(takes).toHaveLength(0)
  })

  it('stops cleanly if cancelled while the microphone opens', async () => {
    let grant!: (value: boolean) => void
    deps.permission = () => new Promise((resolve) => { grant = resolve })
    controller = new TakeRecorderController(deps)
    const starting = controller.start((take) => takes.push(take))
    expect(controller.getSnapshot().phase).toBe('preparing')
    controller.cancel()
    grant(true)
    await starting
    expect(recorders).toHaveLength(0)
    expect(controller.getSnapshot().phase).toBe('idle')
    expect(controller.active).toBe(false)
  })
})
