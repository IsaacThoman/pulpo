// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DailyUsageChart } from './DailyUsageChart'

const barMatchers = vi.hoisted(() => [] as unknown[])
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  // render the chart tree without measuring so the bar props can be inspected
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  BarChart: ({ children }: { children: ReactNode }) => <>{children}</>,
  Bar: ({ animationMatchBy }: { animationMatchBy?: unknown }) => {
    barMatchers.push(animationMatchBy)
    return null
  },
}))

vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {} }), configurable: true }) })

const model = (modelId: string, cost: number) => ({ modelId, calls: 1, tokens: 100, cost })

describe('DailyUsageChart', () => {
  it('folds models reported as other into a single Other series', () => {
    const markup = renderToStaticMarkup(
      <DailyUsageChart
        data={[
          {
            date: '2026-09-14',
            calls: 6,
            tokens: 600,
            cost: 21,
            models: [model('a', 6), model('b', 5), model('c', 4), model('d', 3), model('e', 2), model('other', 1)],
          },
        ]}
        metric="cost"
        periodDayCount={1}
        modelNames={{ other: 'Other', a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' }}
      />,
    )

    expect(markup.match(/>Other</g)).toHaveLength(1)
  })

  it('shows Other when only private models need rolling up', () => {
    const markup = renderToStaticMarkup(
      <DailyUsageChart
        data={[{ date: '2026-09-14', calls: 2, tokens: 200, cost: 3, models: [model('a', 2), model('other', 1)] }]}
        metric="cost"
        periodDayCount={1}
        modelNames={{ other: 'Other', a: 'A' }}
      />,
    )

    expect(markup.match(/>Other</g)).toHaveLength(1)
  })

  it('animates bars by date so range changes keep days in place', () => {
    barMatchers.length = 0
    renderToStaticMarkup(
      <DailyUsageChart
        data={[{ date: '2026-09-14', calls: 1, tokens: 100, cost: 1, models: [model('a', 1)] }]}
        metric="cost"
        periodDayCount={1}
        modelNames={{ a: 'A' }}
      />,
    )

    expect(barMatchers).toHaveLength(1)
    const matchBy = barMatchers[0] as (item: { payload: unknown }, index: number) => unknown
    expect(matchBy({ payload: { date: '2026-09-14' } }, 0)).toBe('2026-09-14')
  })
})
