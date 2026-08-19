import { describe, expect, it } from 'vitest'
import {
  allocateReservationMicros,
  allocateResizedReservationMicros,
  allocateSettlementMicros,
  availableAccountBalanceMicros,
} from './allocation.js'

describe('billing source allocation', () => {
  it('allocates concurrent reservations against pending weekly funds', () => {
    const first = allocateReservationMicros(2_500_000, 3_000_000)
    const second = allocateReservationMicros(2_000_000, 3_000_000 - first.weeklyMicros)
    expect(first).toEqual({ weeklyMicros: 2_500_000, balanceMicros: 0 })
    expect(second).toEqual({ weeklyMicros: 500_000, balanceMicros: 1_500_000 })
  })

  it('resizes in the same week using the reservation own allocation plus live remaining funds', () => {
    expect(allocateResizedReservationMicros({
      amountMicros: 2_500_000,
      weeklyRemainingMicros: 500_000,
      currentWeeklyReservedMicros: 1_500_000,
      reservationPeriodStart: new Date('2026-08-17T00:00:00.000Z'),
      currentPeriodStart: new Date('2026-08-17T00:00:00.000Z'),
    })).toEqual({ weeklyMicros: 2_000_000, balanceMicros: 500_000 })
  })

  it('keeps a cross-Monday reservation bound to its original weekly allocation', () => {
    expect(allocateResizedReservationMicros({
      amountMicros: 3_000_000,
      weeklyRemainingMicros: 4_000_000,
      currentWeeklyReservedMicros: 1_000_000,
      reservationPeriodStart: new Date('2026-08-17T00:00:00.000Z'),
      currentPeriodStart: new Date('2026-08-24T00:00:00.000Z'),
    })).toEqual({ weeklyMicros: 1_000_000, balanceMicros: 2_000_000 })
  })

  it('preserves an existing reservation through a limit reduction without funding new weekly usage', () => {
    expect(allocateReservationMicros(500_000, 0)).toEqual({ weeklyMicros: 0, balanceMicros: 500_000 })
    expect(allocateResizedReservationMicros({
      amountMicros: 2_000_000,
      weeklyRemainingMicros: 0,
      currentWeeklyReservedMicros: 2_000_000,
      reservationPeriodStart: new Date('2026-08-17T00:00:00.000Z'),
      currentPeriodStart: new Date('2026-08-17T00:00:00.000Z'),
    })).toEqual({ weeklyMicros: 2_000_000, balanceMicros: 0 })
  })

  it('settles weekly funds first and releases the unused reservation remainder', () => {
    expect(allocateSettlementMicros(1_200_000, 2_000_000)).toEqual({ weeklyMicros: 1_200_000, balanceMicros: 0 })
    expect(allocateSettlementMicros(2_500_000, 2_000_000)).toEqual({ weeklyMicros: 2_000_000, balanceMicros: 500_000 })
  })

  it('accounts for pending balance reservations and restores the current reservation while resizing', () => {
    expect(availableAccountBalanceMicros({ balanceMicros: 3_000_000, pendingBalanceMicros: 2_500_000 })).toBe(500_000)
    expect(availableAccountBalanceMicros({
      balanceMicros: 3_000_000,
      pendingBalanceMicros: 2_500_000,
      currentBalanceReservedMicros: 1_000_000,
    })).toBe(1_500_000)
  })
})
