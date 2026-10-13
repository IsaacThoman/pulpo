// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  applyAnimationSpeed,
  clampAnimationSpeed,
  normalizeAnimationSpeed,
  scaledAnimationDuration,
  startAnimationSpeedController,
} from './animation-speed'

describe('animation speed', () => {
  it('normalizes persisted values and clamps committed input', () => {
    expect(normalizeAnimationSpeed(0.01)).toBe(0.01)
    expect(normalizeAnimationSpeed(5)).toBe(5)
    expect(normalizeAnimationSpeed(0)).toBe(1)
    expect(normalizeAnimationSpeed(Number.NaN)).toBe(1)
    expect(normalizeAnimationSpeed('2')).toBe(1)
    expect(clampAnimationSpeed(0)).toBe(0.01)
    expect(clampAnimationSpeed(6)).toBe(5)
  })

  it('converts normal durations into exact speed-adjusted durations', () => {
    expect(scaledAnimationDuration(300, 5)).toBe(60)
    expect(scaledAnimationDuration(300, 0.01)).toBe(30_000)
  })

  it('updates animations that are already active', () => {
    const updatePlaybackRate = vi.fn()
    const animation = { playbackRate: 1, updatePlaybackRate } as unknown as Animation
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [animation],
    })

    expect(applyAnimationSpeed(2.5)).toBe(2.5)
    expect(updatePlaybackRate).toHaveBeenCalledWith(2.5)
  })

  it('retimes animations launched after the controller starts once per frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    const updatePlaybackRate = vi.fn()
    const animation = { playbackRate: 1, updatePlaybackRate } as unknown as Animation
    const getAnimations = vi.fn(() => [animation])
    Object.defineProperty(document, 'getAnimations', { configurable: true, value: getAnimations })
    const element = document.createElement('div')
    document.body.append(element)

    startAnimationSpeedController(3)
    getAnimations.mockClear()
    for (let i = 0; i < 100; i++) element.dispatchEvent(new Event('transitionrun', { bubbles: true }))
    element.dispatchEvent(new Event('animationstart', { bubbles: true }))
    expect(frames).toHaveLength(1)
    frames[0](0)

    expect(getAnimations).toHaveBeenCalledTimes(1)
    expect(updatePlaybackRate).toHaveBeenCalledWith(3)
    vi.unstubAllGlobals()
  })
})
