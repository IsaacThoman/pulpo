// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DICTATION_LEVEL_INTERVAL_MS, DICTATION_WAVEFORM_BAR_PITCH, DICTATION_WAVEFORM_SAMPLES, emptyDictationLevels } from '@pulpo/client-core'

type Style = Record<string, unknown>
const mocks = vi.hoisted(() => ({
  layouts: [] as Array<(event: { nativeEvent: { layout: { width: number } } }) => void>,
  sharedValues: [] as Array<{ value: unknown }>,
  timings: [] as unknown[],
  reactions: [] as Array<{ prepare: () => unknown; react: (current: unknown, previous: unknown) => void }>,
}))
const flatten = (style: unknown): Style => (Array.isArray(style) ? style : [style])
  .flat(Infinity as 1)
  .reduce<Style>((acc, part) => Object.assign(acc, part ?? {}), {})

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const View = ({ children, style, onLayout, accessibilityLabel, accessibilityLiveRegion, accessibilityElementsHidden }: {
    children?: ReactNode; style?: unknown; onLayout?: (event: never) => void; accessibilityLabel?: string
    accessibilityLiveRegion?: string; accessibilityElementsHidden?: boolean
  }) => {
    if (onLayout) mocks.layouts.push(onLayout as never)
    return h('div', {
      'data-style': JSON.stringify(flatten(style)), 'aria-label': accessibilityLabel,
      'data-live': accessibilityLiveRegion, 'aria-hidden': accessibilityElementsHidden ? 'true' : undefined,
    }, children)
  }
  return {
    View,
    Text: ({ children, style }: { children?: ReactNode; style?: unknown }) => h('span', { 'data-style': JSON.stringify(flatten(style)) }, children),
    StyleSheet: { create: <T,>(styles: T) => styles },
  }
})
vi.mock('react-native-reanimated', async () => {
  const { createElement: h, useRef } = await import('react')
  return {
    default: {
      View: ({ children, style, entering, exiting }: { children?: ReactNode; style?: unknown; entering?: unknown; exiting?: unknown }) => h('div', {
        'data-testid': 'animated', 'data-style': JSON.stringify(flatten(style)),
        'data-entering': entering ? 'yes' : undefined, 'data-exiting': exiting ? 'yes' : undefined,
      }, children),
    },
    Easing: { out: (curve: string) => `out(${curve})`, inOut: (curve: string) => `inOut(${curve})`, quad: 'quad', cubic: 'cubic', linear: 'linear' },
    ReduceMotion: { System: 'system' },
    // Timings resolve to their target so rendered styles show the settled value.
    withTiming: (target: unknown, config?: unknown) => { mocks.timings.push(config); return target },
    withSequence: (...steps: unknown[]) => ({ sequence: steps }),
    useAnimatedReaction: (prepare: () => unknown, react: (current: unknown, previous: unknown) => void) => {
      mocks.reactions.push({ prepare, react })
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => {
      const ref = useRef<{ value: unknown } | null>(null)
      if (!ref.current) { ref.current = { value: initial }; mocks.sharedValues.push(ref.current) }
      return ref.current
    },
  }
})
import { DictationStatus, DictationStrip, DictationWaveform } from './DictationStrip'
import {
  DICTATION_WAVEFORM_HEIGHT,
  dictationStatusLabel,
  dictationStripEntering,
  dictationStripExiting,
  useDictationToolbarStyle,
} from './dictationMotion'
import type { DictationLevelSource } from './dictation'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const colors = { text: '#111', muted: '#777', warning: '#a50' }
let root: Root
let container: HTMLDivElement

function levelSource(initial: readonly number[] = emptyDictationLevels()) {
  let levels = initial
  const listeners = new Set<() => void>()
  const source: DictationLevelSource = {
    getLevels: () => levels,
    subscribeLevels: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { source, listeners, push: (next: readonly number[]) => { levels = next; listeners.forEach((listener) => listener()) } }
}
const render = (node: ReactNode) => act(async () => root.render(node))
const layout = (width: number) => act(async () => { mocks.layouts.at(-1)!({ nativeEvent: { layout: { width } } }) })
const styleOf = (element: Element) => JSON.parse(element.getAttribute('data-style')!) as Style
const bars = () => [...container.querySelectorAll('[data-testid="animated"]')].map(styleOf).filter((style) => style.width === 2)

beforeEach(() => {
  mocks.layouts.length = 0
  mocks.sharedValues.length = 0
  mocks.reactions.length = 0
  mocks.timings.length = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('DictationWaveform', () => {
  it('fits bars to the measured width and is hidden from accessibility', async () => {
    const { source } = levelSource()
    await render(createElement(DictationWaveform, { source, color: '#111' }))
    expect(bars()).toHaveLength(0)
    await layout(200)
    // Forty visible slots plus the bar sliding out past the left edge.
    expect(bars()).toHaveLength(41)
    await layout(10_000)
    expect(bars()).toHaveLength(DICTATION_WAVEFORM_SAMPLES)
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws the newest samples on the right with height and opacity following loudness', async () => {
    const levels = emptyDictationLevels()
    levels[DICTATION_WAVEFORM_SAMPLES - 1] = 1
    levels[DICTATION_WAVEFORM_SAMPLES - 2] = 0.5
    levels[0] = 1 // Too old to fit the four bars a 15 pt track needs.
    const { source } = levelSource(levels)
    await render(createElement(DictationWaveform, { source, color: '#111' }))
    await layout(15)
    const [leaving, oldest, middle, newest] = bars()
    expect(leaving!.opacity).toBeCloseTo(0.22)
    const scale = (style: Style) => (style.transform as Array<{ scaleY: number }>)[0]!.scaleY
    expect(scale(newest!)).toBe(1)
    expect(newest!.opacity).toBe(1)
    expect(scale(middle!)).toBeCloseTo((2 + 0.5 * (DICTATION_WAVEFORM_HEIGHT - 2)) / DICTATION_WAVEFORM_HEIGHT)
    expect(middle!.opacity).toBeCloseTo(0.61)
    expect(scale(oldest!)).toBeCloseTo(2 / DICTATION_WAVEFORM_HEIGHT)
    expect(oldest!.opacity).toBeCloseTo(0.22)
    expect(newest!.backgroundColor).toBe('#111')
  })

  it('right-aligns a gapped row inside a clipped track', async () => {
    const { source } = levelSource()
    await render(createElement(DictationWaveform, { source, color: '#111' }))
    const track = container.firstElementChild!
    expect(styleOf(track)).toMatchObject({ overflow: 'hidden' })
    expect(styleOf(track.firstElementChild!)).toMatchObject({ position: 'absolute', right: 0, flexDirection: 'row', gap: 3, transform: [{ translateX: 0 }] })
  })

  it('slides the row one bar to the left over each sampling interval when a sample arrives', async () => {
    const { source } = levelSource()
    await render(createElement(DictationWaveform, { source, color: '#111' }))
    const [reaction] = mocks.reactions
    const offset = mocks.sharedValues[1]!
    const levels = mocks.sharedValues[0]!
    expect(reaction!.prepare()).toBe(levels.value)
    reaction!.react(levels.value, null)
    expect(offset.value).toBe(0)
    const previous = levels.value
    reaction!.react(previous, previous)
    expect(offset.value).toBe(0)
    mocks.timings.length = 0
    reaction!.react([...emptyDictationLevels().slice(1), 0.5], previous)
    expect(offset.value).toEqual({ sequence: [DICTATION_WAVEFORM_BAR_PITCH, 0] })
    expect(mocks.timings).toEqual([
      { duration: 0, reduceMotion: 'system' },
      { duration: DICTATION_LEVEL_INTERVAL_MS, easing: 'linear', reduceMotion: 'system' },
    ])
  })

  it('pushes level updates into the shared value without re-rendering and unsubscribes on unmount', async () => {
    const { source, listeners, push } = levelSource()
    await render(createElement(DictationWaveform, { source, color: '#111' }))
    expect(listeners.size).toBe(1)
    const next = [...emptyDictationLevels().slice(1), 0.8]
    push(next)
    expect(mocks.sharedValues[0]!.value).toBe(next)
    await render(null)
    expect(listeners.size).toBe(0)
  })
})

describe('DictationStatus', () => {
  it('shows the waveform and timer while recording', async () => {
    const { source } = levelSource()
    await render(createElement(DictationStatus, { phase: 'recording', seconds: 12, source, colors }))
    const status = container.querySelector('[aria-label="Recording 0:12"]')!
    expect(status.getAttribute('data-live')).toBe('none')
    const [waveformLayer, labelLayer] = [...status.children]
    expect(styleOf(waveformLayer!).opacity).toBe(1)
    expect(styleOf(labelLayer!).opacity).toBe(0)
    const timer = [...waveformLayer!.querySelectorAll('span')].find((span) => span.textContent === '0:12')!
    expect(styleOf(timer)).toMatchObject({ color: '#777', fontVariant: ['tabular-nums'] })
  })

  it('warns in the last ten seconds before the limit', async () => {
    const { source } = levelSource()
    await render(createElement(DictationStatus, { phase: 'recording', seconds: 81, source, colors }))
    const timer = [...container.querySelectorAll('span')].find((span) => span.textContent === '1:21')!
    expect(styleOf(timer).color).toBe('#a50')
  })

  it.each([
    ['preparing', 'Preparing microphone…'],
    ['transcribing', 'Transcribing…'],
    ['cancelling', 'Cancelling…'],
  ] as const)('cross-fades to a polite text status while %s', async (phase, label) => {
    const { source } = levelSource()
    await render(createElement(DictationStatus, { phase, seconds: 4, source, colors }))
    const status = container.querySelector(`[aria-label="${label}"]`)!
    expect(status.getAttribute('data-live')).toBe('polite')
    const [waveformLayer, labelLayer] = [...status.children]
    expect(styleOf(waveformLayer!).opacity).toBe(0)
    expect(styleOf(labelLayer!).opacity).toBe(1)
    expect(labelLayer!.textContent).toBe(label)
  })

  it('labels every phase', () => {
    expect(dictationStatusLabel('recording', 65)).toBe('Recording 1:05')
    expect(dictationStatusLabel('idle', 0)).toBe('Preparing microphone…')
  })
})

describe('DictationStrip', () => {
  it('lays out cancel, status, and finish with enter and exit animations', async () => {
    const { source } = levelSource()
    await render(createElement(DictationStrip, {
      phase: 'recording', seconds: 3, source, colors,
      leading: createElement('button', { 'aria-label': 'Cancel dictation' }),
      trailing: createElement('button', { 'aria-label': 'Finish dictation' }),
    }))
    const strip = container.firstElementChild!
    expect(strip.getAttribute('data-entering')).toBe('yes')
    expect(strip.getAttribute('data-exiting')).toBe('yes')
    expect(styleOf(strip)).toMatchObject({ position: 'absolute', flexDirection: 'row' })
    const children = [...strip.children]
    expect(children[0]!.getAttribute('aria-label')).toBe('Cancel dictation')
    expect(children[1]!.getAttribute('aria-label')).toBe('Recording 0:03')
    expect(children[2]!.getAttribute('aria-label')).toBe('Finish dictation')
  })

  it('rolls in from below and back out the same way', () => {
    const entering = (dictationStripEntering as () => { initialValues: Style; animations: Style })()
    expect(entering.initialValues).toEqual({ opacity: 0, transform: [{ translateY: 22 }] })
    expect(entering.animations).toEqual({ opacity: 1, transform: [{ translateY: 0 }] })
    const exiting = (dictationStripExiting as () => { initialValues: Style; animations: Style })()
    expect(exiting.initialValues).toEqual({ opacity: 1, transform: [{ translateY: 0 }] })
    expect(exiting.animations).toEqual({ opacity: 0, transform: [{ translateY: 22 }] })
  })
})

describe('useDictationToolbarStyle', () => {
  function Toolbar({ dictating }: { dictating: boolean }) {
    const style = useDictationToolbarStyle(dictating)
    return createElement('div', { 'data-testid': 'toolbar', 'data-style': JSON.stringify(style) })
  }
  const toolbarStyle = () => styleOf(container.querySelector('[data-testid="toolbar"]')!)

  it('rolls the toolbar up and out while dictating, then back', async () => {
    await render(createElement(Toolbar, { dictating: false }))
    expect(toolbarStyle()).toEqual({ opacity: 1, transform: [{ translateY: 0 }] })
    await render(createElement(Toolbar, { dictating: true }))
    await render(createElement(Toolbar, { dictating: true }))
    expect(toolbarStyle()).toEqual({ opacity: 0, transform: [{ translateY: -22 }] })
    await render(createElement(Toolbar, { dictating: false }))
    await render(createElement(Toolbar, { dictating: false }))
    expect(toolbarStyle()).toEqual({ opacity: 1, transform: [{ translateY: 0 }] })
  })
})
