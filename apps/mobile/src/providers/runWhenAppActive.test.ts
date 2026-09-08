import { describe, expect, it, vi } from 'vitest'
import { runWhenAppActive } from './runWhenAppActive'

function setup(currentState: string | null) {
  let listener: (state: string) => void = () => {}
  const remove = vi.fn(() => { listener = () => {} })
  const run = vi.fn()
  const cleanup = runWhenAppActive({
    currentState,
    addEventListener: (_event, callback) => { listener = callback; return { remove } },
  }, run)
  return { run, cleanup, remove, change: (state: string) => listener(state) }
}

describe('foreground bootstrap', () => {
  it.each(['background', 'inactive', null])('defers hydration from %s until active', (state) => {
    const app = setup(state)
    expect(app.run).not.toHaveBeenCalled()
    app.change('inactive')
    expect(app.run).not.toHaveBeenCalled()
    app.change('active')
    expect(app.run).toHaveBeenCalledOnce()
    app.change('background')
    app.change('active')
    expect(app.run).toHaveBeenCalledOnce()
  })

  it('hydrates immediately when already active', () => {
    const app = setup('active')
    expect(app.run).toHaveBeenCalledOnce()
    app.change('active')
    expect(app.run).toHaveBeenCalledOnce()
  })

  it('cancels pending bootstrap on unmount', () => {
    const app = setup('background')
    app.cleanup()
    expect(app.remove).toHaveBeenCalledOnce()
    app.change('active')
    expect(app.run).not.toHaveBeenCalled()
  })
})
