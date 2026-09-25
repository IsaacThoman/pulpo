// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Animation = { kind: string; args: unknown[] }
const mocks = vi.hoisted(() => ({
  assigned: [] as unknown[],
  cancelled: 0,
}))
vi.mock('react-native-reanimated', async () => {
  const { createElement: h, useRef } = await import('react')
  const animation = (kind: string) => (...args: unknown[]) => ({ kind, args })
  return {
    default: {
      View: ({ children, style }: { children?: ReactNode; style: unknown }) => {
        const flat = (Array.isArray(style) ? style : [style]).reduce<Record<string, unknown>>((acc, part) => Object.assign(acc, part), {})
        return h('div', { 'data-testid': 'animated', 'data-style': JSON.stringify(flat) }, children)
      },
    },
    useSharedValue: (initial: unknown) => {
      const ref = useRef<{ current: unknown } | null>(null)
      if (!ref.current) {
        const holder = { current: initial }
        ref.current = holder
        Object.defineProperty(ref.current, 'value', {
          get: () => holder.current,
          set: (next: unknown) => { holder.current = next; mocks.assigned.push(next) },
        })
      }
      return ref.current
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    cancelAnimation: () => { mocks.cancelled += 1 },
    withRepeat: animation('repeat'),
    withTiming: animation('timing'),
    withSequence: animation('sequence'),
    Easing: { linear: 'linear', bezier: (...points: number[]) => `bezier(${points.join(',')})` },
  }
})
vi.mock('lucide-react-native', () => ({
  Loader2: ({ color, size }: { color: string; size: number }) => createElement('svg', { 'data-icon': 'loader', 'data-color': color, 'data-size': size }),
}))
import { PULSE_CYCLE_MS, PulsingIcon, SPINNER_REVOLUTION_MS, SpinningLoader } from './SpinningLoader'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  mocks.assigned.length = 0
  mocks.cancelled = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
const render = (node: ReactNode) => act(async () => root.render(node))
const animations = () => mocks.assigned.filter((value): value is Animation => typeof value === 'object' && value !== null && 'kind' in value)

describe('SpinningLoader', () => {
  it('renders the loader icon inside a sized rotating view', async () => {
    await render(createElement(SpinningLoader, { color: '#888', size: 13 }))
    const icon = container.querySelector('[data-icon="loader"]')!
    expect(icon.getAttribute('data-color')).toBe('#888')
    expect(icon.getAttribute('data-size')).toBe('13')
    const style = JSON.parse(container.querySelector('[data-testid="animated"]')!.getAttribute('data-style')!)
    expect(style).toMatchObject({ width: 13, height: 13, transform: [{ rotate: '0deg' }] })
  })

  it('loops a full linear revolution forever', async () => {
    await render(createElement(SpinningLoader, { color: '#888', size: 14 }))
    expect(animations()).toEqual([{
      kind: 'repeat',
      args: [{ kind: 'timing', args: [360, { duration: SPINNER_REVOLUTION_MS, easing: 'linear' }] }, -1, false],
    }])
  })

  it('stays still when reduce motion is enabled', async () => {
    await render(createElement(SpinningLoader, { color: '#888', size: 14, reduceMotion: true }))
    expect(animations()).toEqual([])
  })

  it('stops the animation on unmount and when reduce motion turns on', async () => {
    await render(createElement(SpinningLoader, { color: '#888', size: 14 }))
    const before = mocks.cancelled
    await render(createElement(SpinningLoader, { color: '#888', size: 14, reduceMotion: true }))
    expect(mocks.cancelled).toBeGreaterThan(before)
    expect(mocks.assigned.at(-1)).toBe(0)
  })
})

describe('PulsingIcon', () => {
  it('loops opacity between full and half like web animate-pulse', async () => {
    await render(<PulsingIcon><i data-icon="wrench" /></PulsingIcon>)
    expect(container.querySelector('[data-icon="wrench"]')).not.toBeNull()
    const half = { duration: PULSE_CYCLE_MS / 2, easing: 'bezier(0.4,0,0.6,1)' }
    expect(animations()).toEqual([{
      kind: 'repeat',
      args: [{ kind: 'sequence', args: [{ kind: 'timing', args: [0.5, half] }, { kind: 'timing', args: [1, half] }] }, -1, false],
    }])
  })

  it('stays fully opaque when reduce motion is enabled', async () => {
    await render(<PulsingIcon reduceMotion><i /></PulsingIcon>)
    expect(animations()).toEqual([])
    expect(JSON.parse(container.querySelector('[data-testid="animated"]')!.getAttribute('data-style')!)).toEqual({ opacity: 1 })
  })
})
