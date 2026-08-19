import { splitReservationMicros } from './plans.js'

export interface FundingAllocation {
  weeklyMicros: number
  balanceMicros: number
}

export function allocateReservationMicros(amountMicros: number, weeklyAvailableMicros: number): FundingAllocation {
  return splitReservationMicros(amountMicros, weeklyAvailableMicros)
}

export function allocateResizedReservationMicros(input: {
  amountMicros: number
  weeklyRemainingMicros: number
  currentWeeklyReservedMicros: number
  reservationPeriodStart: Date | null
  currentPeriodStart: Date
}): FundingAllocation {
  const sameWeek = input.reservationPeriodStart?.getTime() === input.currentPeriodStart.getTime()
  const weeklyAvailableMicros = sameWeek
    ? input.weeklyRemainingMicros + input.currentWeeklyReservedMicros
    : input.currentWeeklyReservedMicros
  return allocateReservationMicros(input.amountMicros, weeklyAvailableMicros)
}

export function allocateSettlementMicros(costMicros: number, weeklyReservedMicros: number): FundingAllocation {
  const weeklyMicros = Math.min(costMicros, weeklyReservedMicros)
  return { weeklyMicros, balanceMicros: costMicros - weeklyMicros }
}

export function availableAccountBalanceMicros(input: {
  balanceMicros: number
  pendingBalanceMicros: number
  currentBalanceReservedMicros?: number
}): number {
  return input.balanceMicros - input.pendingBalanceMicros + (input.currentBalanceReservedMicros ?? 0)
}
