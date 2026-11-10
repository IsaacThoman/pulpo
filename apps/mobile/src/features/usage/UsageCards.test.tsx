// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

type PressableProps = { children?: ReactNode; onPress?: (event: unknown) => void; accessibilityLabel?: string; accessibilityState?: { selected?: boolean } }
const mocks = vi.hoisted(() => ({ touch: { locationX: 0, locationY: 0 } }))
const { passthrough } = vi.hoisted(() => ({ passthrough: ({ children }: { children?: unknown }) => children }))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  View: ({ children, accessibilityLabel }: { children?: ReactNode; accessibilityLabel?: string }) => createElement('div', { 'aria-label': accessibilityLabel }, children),
  Pressable: ({ children, onPress, accessibilityLabel, accessibilityState }: PressableProps) => createElement('button', { onClick: () => onPress?.({ nativeEvent: mocks.touch }), 'aria-label': accessibilityLabel, 'aria-pressed': accessibilityState?.selected }, children),
  ScrollView: passthrough,
  RefreshControl: () => null,
  ActivityIndicator: () => null,
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: passthrough }))
vi.mock('../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../../mockup5/src/components/ProfileAvatar', () => ({ ProfileAvatar: () => null }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ secondary: 'gray', tertiary: 'gray', text: 'black', blue: '#0000ff', red: 'red', fill: 'gray', fillStrong: 'gray', separator: 'gray', background: 'white' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({ Card: passthrough, PageHeader: () => null, SectionTitle: passthrough, ListRow: () => null, Segmented: () => null }))
import { dayKey, type UsageActivity } from './format'
import { UsageChartCard, UsageYearCard } from './UsageCards'

const day = (daysAgo: number) => dayKey(new Date(2026, 10, 10 - daysAgo, 12))
const row = (daysAgo: number, calls: number) => ({ day: day(daysAgo), calls, inputTokens: calls * 50, outputTokens: calls * 50 })
const activity: UsageActivity = {
  summary: { calls: 7, inputTokens: 350, outputTokens: 350, firstUsedAt: null },
  daily: [row(0, 4), row(1, 3)],
  contribution: [row(0, 4), row(1, 3)],
  topModels: [],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 10, 12))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('shows the period’s total until a bar is tapped, then that day', () => {
  render(<UsageChartCard activity={activity} range="7d" metric="calls" />)
  expect(screen.getByLabelText('Calls, 7 calls')).toBeTruthy()
  expect(screen.getAllByRole('button')).toHaveLength(8)
  const today = screen.getByRole('button', { name: 'Nov 10, 4 calls' })
  fireEvent.click(today)
  expect(screen.getByLabelText('Nov 10, 4 calls', { selector: 'div' })).toBeTruthy()
  expect(today.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(today)
  expect(screen.getByLabelText('Calls, 7 calls')).toBeTruthy()
})

it('forgets the tapped bar when the bars change', () => {
  const { rerender } = render(<UsageChartCard activity={activity} range="7d" metric="calls" />)
  fireEvent.click(screen.getByRole('button', { name: 'Nov 9, 3 calls' }))
  rerender(<UsageChartCard activity={activity} range="7d" metric="tokens" />)
  expect(screen.getByLabelText('Tokens, 700 tokens')).toBeTruthy()
})

it('says there is nothing to chart in a period without usage', () => {
  render(<UsageChartCard activity={{ ...activity, summary: { ...activity.summary, calls: 0 }, daily: [] }} range="7d" metric="calls" />)
  expect(screen.getByText('No usage in this period.')).toBeTruthy()
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})

it('reads a day of the year when its square is tapped', () => {
  render(<UsageYearCard activity={activity} metric="calls" />)
  expect(screen.getByText('2 active days in the last year')).toBeTruthy()
  const year = screen.getByRole('button', { name: 'Activity over the last year. 2 active days in the last year.' })
  // Squares are 15 apart under a 16-high row of month names. The last column is this week;
  // Nov 10, 2026 is a Tuesday, the third row.
  const touch = (column: number, row: number) => ({ locationX: column * 15 + 4, locationY: 16 + row * 15 + 4 })
  mocks.touch = touch(52, 2)
  fireEvent.click(year)
  expect(screen.getByText('4 calls on Nov 10, 2026')).toBeTruthy()
  mocks.touch = touch(52, 0)
  fireEvent.click(year)
  expect(screen.getByText('No calls on Nov 8, 2026')).toBeTruthy()
  // Days after today have no square.
  mocks.touch = touch(52, 5)
  fireEvent.click(year)
  expect(screen.getByText('Tap a day to see its usage.')).toBeTruthy()
})
