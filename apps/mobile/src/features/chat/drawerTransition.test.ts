import { describe, expect, it, vi } from 'vitest'
import { createDrawerTransition } from './drawerTransition'

describe('drawer navigation completion', () => {
  it('defers transcript switching until successful completion and commits once', () => {
    const transition = createDrawerTransition()
    const switchChat = vi.fn()
    const finish = transition.begin(switchChat)
    expect(switchChat).not.toHaveBeenCalled()
    finish(true)
    finish(true)
    expect(switchChat).toHaveBeenCalledOnce()
  })

  it('does not select a chat when its closing spring is interrupted', () => {
    const transition = createDrawerTransition()
    const switchChat = vi.fn()
    const finish = transition.begin(switchChat)
    finish(false)
    finish(true)
    expect(switchChat).not.toHaveBeenCalled()
  })

  it('ignores older completion callbacks after another selection or reopening', () => {
    const transition = createDrawerTransition()
    const first = vi.fn()
    const second = vi.fn()
    const finishFirst = transition.begin(first)
    const finishSecond = transition.begin(second)
    finishFirst(true)
    finishSecond(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('rejects queued callbacks after gesture, scope, or unmount cancellation', () => {
    const transition = createDrawerTransition()
    const switchChat = vi.fn()
    const finish = transition.begin(switchChat)
    transition.cancel()
    finish(true)
    expect(switchChat).not.toHaveBeenCalled()
    transition.begin(switchChat)(true)
    expect(switchChat).toHaveBeenCalledOnce()
  })

  it('supports immediate completion for reduced motion and persistent sidebars', () => {
    const transition = createDrawerTransition()
    const switchChat = vi.fn()
    transition.begin(switchChat)(true)
    expect(switchChat).toHaveBeenCalledOnce()
  })
})
