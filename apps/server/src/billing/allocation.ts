import { splitReservationMicros } from './plans.js'

export interface FundingAllocation {
  weeklyMicros: number
  fiveHourMicros: number
  balanceMicros: number
}

export function allocateReservationMicros(amountMicros: number, weeklyAvailableMicros: number, fiveHourAvailableMicros: number): FundingAllocation {
  return splitReservationMicros(amountMicros, weeklyAvailableMicros, fiveHourAvailableMicros)
}

export function allocateResizedReservationMicros(input: {
  amountMicros: number
  weeklyRemainingMicros: number
  currentWeeklyReservedMicros: number
  reservationWeeklyPeriodStart: Date | null
  currentWeeklyPeriodStart: Date
  fiveHourRemainingMicros: number
  currentFiveHourReservedMicros: number
  reservationFiveHourPeriodStart: Date | null
  currentFiveHourPeriodStart: Date | null
}): FundingAllocation {
  const sameWeek = input.reservationWeeklyPeriodStart?.getTime() === input.currentWeeklyPeriodStart.getTime()
  const weeklyAvailableMicros = sameWeek
    ? input.weeklyRemainingMicros + input.currentWeeklyReservedMicros
    : input.currentWeeklyReservedMicros
  const sameFiveHourPeriod = input.reservationFiveHourPeriodStart?.getTime() === input.currentFiveHourPeriodStart?.getTime()
  const fiveHourAvailableMicros = sameFiveHourPeriod
    ? input.fiveHourRemainingMicros + input.currentFiveHourReservedMicros
    : input.currentFiveHourReservedMicros
  return allocateReservationMicros(input.amountMicros, weeklyAvailableMicros, fiveHourAvailableMicros)
}

export function allocateSettlementMicros(costMicros: number, weeklyReservedMicros: number, fiveHourReservedMicros: number): FundingAllocation {
  const coveredMicros = Math.min(costMicros, weeklyReservedMicros, fiveHourReservedMicros)
  return { weeklyMicros: coveredMicros, fiveHourMicros: coveredMicros, balanceMicros: costMicros - coveredMicros }
}

export function availableAccountBalanceMicros(input: {
  balanceMicros: number
  pendingBalanceMicros: number
  currentBalanceReservedMicros?: number
}): number {
  return input.balanceMicros - input.pendingBalanceMicros + (input.currentBalanceReservedMicros ?? 0)
}

export function allocateProportionallyMicros(amountMicros: number, balances: Array<{ userId: string; availableMicros: number }>): Map<string, number> {
  const positive = balances.filter((row) => row.availableMicros > 0).sort((a, b) => a.userId.localeCompare(b.userId))
  const total = positive.reduce((sum, row) => sum + row.availableMicros, 0)
  if (amountMicros > total) return new Map()
  if (amountMicros <= 0) return new Map()
  const totalBig = BigInt(total)
  const exact = positive.map((row) => {
    const product = BigInt(amountMicros) * BigInt(row.availableMicros)
    return { ...row, value: Number(product / totalBig), remainder: product % totalBig }
  })
  let remaining = amountMicros - exact.reduce((sum, row) => sum + row.value, 0)
  exact.sort((a, b) => a.remainder === b.remainder ? a.userId.localeCompare(b.userId) : a.remainder > b.remainder ? -1 : 1)
  for (const row of exact) {
    if (remaining <= 0) break
    row.value += 1
    remaining -= 1
  }
  return new Map(exact.filter((row) => row.value > 0).map((row) => [row.userId, row.value]))
}

export function allocatePoolBalanceMicros(input: {
  amountMicros: number
  callerUserId: string
  balances: Array<{ userId: string; availableMicros: number }>
}): Map<string, number> {
  const caller = input.balances.find((row) => row.userId === input.callerUserId)?.availableMicros ?? 0
  const own = Math.min(input.amountMicros, caller)
  const remainder = input.amountMicros - own
  const result = new Map<string, number>()
  if (own > 0) result.set(input.callerUserId, own)
  if (remainder <= 0) return result
  const shared = allocateProportionallyMicros(remainder, input.balances.filter((row) => row.userId !== input.callerUserId))
  if (!shared.size) return new Map()
  for (const [userId, amount] of shared) result.set(userId, amount)
  return result
}
