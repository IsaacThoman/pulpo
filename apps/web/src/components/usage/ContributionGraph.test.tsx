// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContributionGraph } from './ContributionGraph'

const monthLabels = (markup: string) =>
  [...markup.matchAll(/<span class="absolute top-0[^"]*" style="left:(\d+)px">(\w+)<\/span>/g)].map((m) => ({
    left: Number(m[1]),
    text: m[2],
  }))

describe('ContributionGraph', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a partial leading month label that would overlap the next month', () => {
    vi.useFakeTimers()
    // window starts Thu Sep 25 2025: first Sunday is Sep 28, then Oct 5 one column later
    vi.setSystemTime(new Date(2026, 8, 24, 12))

    const labels = monthLabels(renderToStaticMarkup(<ContributionGraph data={[]} metric="tokens" />))

    expect(labels[0].text).toBe('Oct')
    expect(labels.map((l) => l.text).filter((t) => t === 'Sep')).toHaveLength(1)
    for (let i = 1; i < labels.length; i++) expect(labels[i].left - labels[i - 1].left).toBeGreaterThanOrEqual(3 * 14)
  })

  it('keeps the leading month label when it has room', () => {
    vi.useFakeTimers()
    // window starts Sun Sep 14 2025: Sep gets three columns before Oct 5
    vi.setSystemTime(new Date(2026, 8, 13, 12))

    const labels = monthLabels(renderToStaticMarkup(<ContributionGraph data={[]} metric="tokens" />))

    expect(labels.slice(0, 2).map((l) => l.text)).toEqual(['Sep', 'Oct'])
  })
})
