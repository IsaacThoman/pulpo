// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DICTATION_LEVEL_INTERVAL_MS, DICTATION_WAVEFORM_BAR_PITCH, dictationWaveformBarCount, normalizeDictationDecibels } from '@pulpo/client-core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DictationBar, DictationWaveform } from './DictationBar'
import { WEB_DICTATION_WAVEFORM_SAMPLES, useMicrophoneLevels } from './use-microphone-levels'

const audio = vi.hoisted(() => ({
  contexts: [] as FakeAudioContext[],
  sample: 0,
  fail: false,
}))
class FakeAnalyser {
  fftSize = 2048
  getFloatTimeDomainData(buffer: Float32Array) { buffer.fill(audio.sample) }
}
class FakeAudioContext {
  state = 'suspended'
  closed = false
  resumed = false
  source = { connect: vi.fn(), disconnect: vi.fn() }
  streams: MediaStream[] = []
  constructor() {
    if (audio.fail) throw new Error('AudioContext unavailable')
    audio.contexts.push(this)
  }
  createMediaStreamSource(stream: MediaStream) { this.streams.push(stream); return this.source }
  createAnalyser() { return new FakeAnalyser() }
  async resume() { this.resumed = true; this.state = 'running' }
  async close() { this.closed = true }
}

let observedWidth = 0
class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback }
  observe() { this.callback([{ contentRect: { width: observedWidth } } as ResizeObserverEntry], this as never) }
  disconnect() {}
  unobserve() {}
}

const stream = { id: 'mic' } as unknown as MediaStream

beforeEach(() => {
  audio.contexts.length = 0
  audio.sample = 0
  audio.fail = false
  observedWidth = 0
  vi.useFakeTimers()
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useMicrophoneLevels', () => {
  it('stays silent and opens no audio graph without a stream', () => {
    const { result } = renderHook(() => useMicrophoneLevels(null))
    expect(result.current).toHaveLength(WEB_DICTATION_WAVEFORM_SAMPLES)
    expect(result.current.every((level) => level === 0)).toBe(true)
    expect(audio.contexts).toHaveLength(0)
  })

  it('analyses the microphone stream into a scrolling loudness history', () => {
    const { result } = renderHook(() => useMicrophoneLevels(stream, 8))
    const [context] = audio.contexts
    expect(context!.streams).toEqual([stream])
    expect(context!.source.connect).toHaveBeenCalledOnce()
    expect(context!.resumed).toBe(true)
    audio.sample = 0.1 // -20 dBFS
    act(() => { vi.advanceTimersByTime(DICTATION_LEVEL_INTERVAL_MS) })
    audio.sample = 1
    act(() => { vi.advanceTimersByTime(DICTATION_LEVEL_INTERVAL_MS) })
    expect(result.current).toHaveLength(8)
    expect(result.current.at(-2)).toBeCloseTo(normalizeDictationDecibels(-20))
    expect(result.current.at(-1)).toBe(1)
    expect(result.current.slice(0, 6).every((level) => level === 0)).toBe(true)
  })

  it('does not re-render while the room stays silent', () => {
    let renders = 0
    renderHook(() => { renders += 1; return useMicrophoneLevels(stream, 8) })
    const before = renders
    act(() => { vi.advanceTimersByTime(DICTATION_LEVEL_INTERVAL_MS * 10) })
    expect(renders).toBe(before)
  })

  it('closes the audio graph and resets when the stream ends', () => {
    const { result, rerender } = renderHook(({ input }) => useMicrophoneLevels(input, 8), { initialProps: { input: stream as MediaStream | null } })
    audio.sample = 0.5
    act(() => { vi.advanceTimersByTime(DICTATION_LEVEL_INTERVAL_MS) })
    expect(result.current.at(-1)).toBeGreaterThan(0)
    rerender({ input: null })
    const [context] = audio.contexts
    expect(context!.source.disconnect).toHaveBeenCalledOnce()
    expect(context!.closed).toBe(true)
    expect(result.current.every((level) => level === 0)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps recording with a flat waveform when audio analysis is unavailable', () => {
    audio.fail = true
    const { result } = renderHook(() => useMicrophoneLevels(stream, 8))
    act(() => { vi.advanceTimersByTime(DICTATION_LEVEL_INTERVAL_MS * 3) })
    expect(result.current.every((level) => level === 0)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('DictationWaveform', () => {
  const bars = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-testid="dictation-waveform-row"] > span')]
  const row = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-testid="dictation-waveform-row"]')!
  function stubAnimate() {
    const animations: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn> }> = []
    const animate = vi.fn(function (keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = { keyframes, options, cancel: vi.fn() }
      animations.push(animation)
      return animation as unknown as Animation
    })
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    return animations
  }
  function setReducedMotion(reduce: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' }))
  }
  afterEach(() => { delete (HTMLElement.prototype as { animate?: unknown }).animate })

  it('covers the width plus one leaving bar, with the newest sample on the right', () => {
    observedWidth = 15
    const levels = [1, 0, 0, 0.5, 1]
    const { container } = render(<DictationWaveform levels={levels} />)
    const rendered = bars(container)
    expect(rendered.map((bar) => Number(bar.dataset.level))).toEqual([0, 0, 0.5, 1])
    expect(rendered[3]!.style.transform).toBe('scaleY(1)')
    expect(rendered[3]!.style.opacity).toBe('1')
    expect(rendered[0]!.style.transform).toBe(`scaleY(${2 / 24})`)
    expect(Number(rendered[0]!.style.opacity)).toBeCloseTo(0.22)
    expect(rendered[0]!.style.width).toBe('2px')
    expect(container.querySelector('[data-testid="dictation-waveform"]')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('right-aligns a gapped row inside a clipped track', () => {
    observedWidth = 100
    const { container } = render(<DictationWaveform levels={[0, 0, 0]} />)
    expect(container.querySelector('[data-testid="dictation-waveform"]')!.className).toContain('overflow-hidden')
    expect(row(container).className).toContain('right-0')
    expect(row(container).style.gap).toBe('3px')
  })

  it('never draws more bars than the history holds', () => {
    observedWidth = 10_000
    const { container } = render(<DictationWaveform levels={[0.2, 0.4]} />)
    expect(bars(container)).toHaveLength(2)
  })

  it('slides the row one bar to the left over each sampling interval when a sample arrives', () => {
    setReducedMotion(false)
    const animations = stubAnimate()
    observedWidth = 20
    const first = [0, 0, 0, 0, 0.2, 0.4]
    const view = render(<DictationWaveform levels={first} />)
    expect(animations).toHaveLength(0)
    view.rerender(<DictationWaveform levels={first} />)
    expect(animations).toHaveLength(0)
    view.rerender(<DictationWaveform levels={[0, 0, 0, 0.2, 0.4, 0.9]} />)
    expect(animations).toHaveLength(1)
    expect(animations[0]!.keyframes).toEqual([{ transform: 'translateX(5px)' }, { transform: 'translateX(0)' }])
    expect(animations[0]!.options).toEqual({ duration: DICTATION_LEVEL_INTERVAL_MS, easing: 'linear' })
    view.rerender(<DictationWaveform levels={[0, 0, 0.2, 0.4, 0.9, 0.1]} />)
    expect(animations[0]!.cancel).toHaveBeenCalledOnce()
    view.unmount()
    expect(animations[1]!.cancel).toHaveBeenCalledOnce()
  })

  it('steps without sliding when reduced motion is requested', () => {
    setReducedMotion(true)
    const animations = stubAnimate()
    const view = render(<DictationWaveform levels={[0, 0.2]} />)
    view.rerender(<DictationWaveform levels={[0.2, 0.4]} />)
    expect(animations).toHaveLength(0)
  })
})

describe('DictationBar', () => {
  function renderBar(props: Partial<Parameters<typeof DictationBar>[0]> = {}) {
    const handlers = { onCancel: vi.fn(), onConfirm: vi.fn() }
    const all = { phase: 'recording' as const, stream, startedAt: Date.now(), ...handlers, ...props }
    const view = render(<TooltipProvider><DictationBar {...all} /></TooltipProvider>)
    return { ...view, ...handlers, rerenderBar: (next: Partial<Parameters<typeof DictationBar>[0]>) => view.rerender(<TooltipProvider><DictationBar {...all} {...next} /></TooltipProvider>) }
  }

  it('fills the whole track up to the cancel button, even in the widest composer', () => {
    // 90rem composer minus the side controls still fits inside the history.
    expect(WEB_DICTATION_WAVEFORM_SAMPLES * DICTATION_WAVEFORM_BAR_PITCH).toBeGreaterThanOrEqual(1440)
    observedWidth = 1200
    const view = renderBar()
    const bars = view.container.querySelectorAll('[data-testid="dictation-waveform-row"] > span')
    expect(bars).toHaveLength(dictationWaveformBarCount(1200, WEB_DICTATION_WAVEFORM_SAMPLES))
    expect(bars.length * DICTATION_WAVEFORM_BAR_PITCH).toBeGreaterThan(1200)
  })

  it('shows a waveform and running timer while recording', () => {
    const view = renderBar()
    expect(view.getByRole('status', { name: 'Recording 0:00' }).getAttribute('aria-live')).toBe('off')
    act(() => { vi.advanceTimersByTime(12_000) })
    expect(view.getByTestId('dictation-elapsed').textContent).toBe('0:12')
    expect(view.getByRole('status', { name: 'Recording 0:12' })).toBeTruthy()
    expect(view.getByTestId('dictation-elapsed').className).toContain('text-muted-foreground')
    expect(audio.contexts).toHaveLength(1)
  })

  it('turns the timer amber in the last ten seconds', () => {
    const view = renderBar({ startedAt: Date.now() - 80_000 })
    expect(view.getByTestId('dictation-elapsed').textContent).toBe('1:20')
    expect(view.getByTestId('dictation-elapsed').className).toContain('text-amber-600')
  })

  it('cancels and finishes through its buttons', () => {
    const view = renderBar()
    fireEvent.click(view.getByRole('button', { name: 'Cancel dictation' }))
    fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
    expect(view.onCancel).toHaveBeenCalledOnce()
    expect(view.onConfirm).toHaveBeenCalledOnce()
  })

  it.each([
    ['preparing', 'Waiting for microphone…'],
    ['transcribing', 'Transcribing…'],
  ] as const)('announces %s politely and only allows cancelling', (phase, label) => {
    const view = renderBar({ phase })
    expect(view.getByRole('status', { name: label }).getAttribute('aria-live')).toBe('polite')
    expect(view.getByRole('button', { name: 'Finish dictation' }).hasAttribute('disabled')).toBe(true)
    expect(view.getByRole('button', { name: 'Cancel dictation' }).hasAttribute('disabled')).toBe(false)
    expect(audio.contexts).toHaveLength(0)
  })

  it('keeps showing the last phase while animating away and stops metering', () => {
    const view = renderBar({ phase: 'transcribing' })
    view.rerenderBar({ phase: 'idle', stream: null, startedAt: null })
    expect(view.getByRole('status', { name: 'Transcribing…' })).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })
})
