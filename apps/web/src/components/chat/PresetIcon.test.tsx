// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IconNode } from 'lucide-react'

const loaders = vi.hoisted(() => ({ brain: vi.fn(), gauge: vi.fn(), rocket: vi.fn() }))
vi.mock('lucide-react/dynamic.js', () => ({ dynamicIconImports: loaders }))

import { PresetIcon } from './PresetIcon'

const brainNode: IconNode = [['path', { key: 'brain', d: 'M1 2L3 4', 'data-testid': 'brain' }]]
const gaugeNode: IconNode = [['path', { key: 'gauge', d: 'M5 6L7 8', 'data-testid': 'gauge' }]]

afterEach(cleanup)

describe('PresetIcon rendering', () => {
  it('shares pending loads and renders cached icons immediately after remounting', async () => {
    let resolve!: (value: { __iconNode: IconNode }) => void
    loaders.brain.mockReturnValue(new Promise((done) => { resolve = done }))
    const first = render(<><PresetIcon name="brain" /><PresetIcon name="brain" /></>)
    expect(first.container.querySelectorAll('circle')).toHaveLength(2)
    expect(loaders.brain).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ __iconNode: brainNode }) })
    expect(first.getAllByTestId('brain')).toHaveLength(2)
    first.unmount()

    // No effects or async work can run during this render.
    expect(renderToStaticMarkup(<PresetIcon name="brain" />)).toContain('data-testid="brain"')
    const remounted = render(<PresetIcon name="brain" className="opacity-70" />)
    expect(remounted.getByTestId('brain')).toBeTruthy()
    expect(remounted.container.querySelector('circle')).toBeNull()
    expect(remounted.container.querySelector('svg')?.classList.contains('opacity-70')).toBe(true)
    expect(loaders.brain).toHaveBeenCalledTimes(1)
  })

  it('does not display a previous icon when the name changes during loading', async () => {
    let resolve!: (value: { __iconNode: IconNode }) => void
    loaders.gauge.mockReturnValue(new Promise((done) => { resolve = done }))
    const view = render(<PresetIcon name="gauge" />)
    view.rerender(<PresetIcon name="not-an-icon" />)
    await act(async () => { resolve({ __iconNode: gaugeNode }) })
    expect(view.queryByTestId('gauge')).toBeNull()
    expect(view.container.querySelector('circle')).toBeTruthy()
    view.rerender(<PresetIcon name="gauge" />)
    expect(view.getByTestId('gauge')).toBeTruthy()
    expect(view.container.querySelector('circle')).toBeNull()
  })

  it('keeps the fallback on failure and retries on a later mount', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      loaders.rocket.mockRejectedValueOnce(new Error('Chunk unavailable'))
      const first = render(<PresetIcon name="rocket" />)
      await act(async () => {})
      expect(first.container.querySelector('circle')).toBeTruthy()
      expect(error).toHaveBeenCalledTimes(1)
      first.unmount()
      loaders.rocket.mockResolvedValueOnce({ __iconNode: gaugeNode })
      const retried = render(<PresetIcon name="rocket" />)
      await act(async () => {})
      expect(retried.container.querySelector('circle')).toBeNull()
      expect(loaders.rocket).toHaveBeenCalledTimes(2)
    } finally {
      error.mockRestore()
    }
  })
})
