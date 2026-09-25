import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createRenderCache } from './render-cache'

const list = (items: number) => createElement('ul', null, Array.from({ length: items }, (_, index) => createElement('li', { key: index }, index)))

describe('createRenderCache', () => {
  it('renders each key once while it stays cached', () => {
    const cached = createRenderCache(100)
    const render = vi.fn(() => list(3))

    const first = cached('a', render)

    expect(cached('a', render)).toBe(first)
    expect(render).toHaveBeenCalledOnce()
  })

  it('evicts the least recently used entries beyond the element budget', () => {
    const cached = createRenderCache(10)
    const a = cached('a', () => list(3))
    const b = cached('b', () => list(3))
    cached('a', () => list(3))
    cached('c', () => list(3))

    expect(cached('a', () => list(3))).toBe(a)
    expect(cached('b', () => list(3))).not.toBe(b)
  })

  it('does not retain an element larger than the whole budget', () => {
    const cached = createRenderCache(10)
    const large = cached('large', () => list(20))

    expect(cached('large', () => list(20))).not.toBe(large)
  })
})
