import { describe, expect, it } from 'vitest'
import { CapacityReservationError, CapacityTracker, WorkspaceCapacityError } from './capacity.js'

function tracker(maxActiveTotal = 10) {
  let now = 1_000
  let sequence = 0
  const value = new CapacityTracker({
    maxActiveTotal,
    reservationTtlMs: 30_000,
    now: () => now,
    newId: () => `reservation-${++sequence}`,
  })
  return { value, advance: (milliseconds: number) => { now += milliseconds } }
}

describe('workspace capacity reservations', () => {
  it('enforces per-instance capacity across active leases and pending reservations', () => {
    const { value } = tracker()
    value.reserve('production', 2, 1, 1)

    expect(() => value.reserve('production', 2, 1, 1)).toThrowError(WorkspaceCapacityError)
    expect(value.pendingForInstance('production')).toBe(1)
  })

  it('enforces global capacity across instances', () => {
    const { value } = tracker(2)
    value.reserve('production', 3, 1, 1)

    try {
      value.reserve('preview', 3, 0, 1)
      throw new Error('Expected controller capacity to be exhausted')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceCapacityError)
      expect((error as WorkspaceCapacityError).scope).toBe('controller')
    }
  })

  it('allows only the owning instance to consume a reservation once', () => {
    const { value } = tracker()
    const reservation = value.reserve('production', 2, 0, 0)

    expect(() => value.consume(reservation.id, 'preview')).toThrowError(CapacityReservationError)
    expect(value.consume(reservation.id, 'production').state).toBe('consumed')
    expect(() => value.consume(reservation.id, 'production')).toThrowError(CapacityReservationError)
    expect(value.pendingCount).toBe(1)

    value.complete(reservation.id)
    expect(value.pendingCount).toBe(0)
  })

  it('expires and explicitly releases unconsumed reservations', () => {
    const { value, advance } = tracker()
    const expired = value.reserve('production', 3, 0, 0)
    advance(30_000)

    expect(() => value.consume(expired.id, 'production')).toThrowError(CapacityReservationError)
    expect(value.pendingCount).toBe(0)

    const cancelled = value.reserve('production', 3, 0, 0)
    expect(value.cancel(cancelled.id, 'production')).toBe(true)
    expect(value.cancel(cancelled.id, 'production')).toBe(false)
    expect(value.pendingCount).toBe(0)
  })

  it('holds consumed capacity beyond the reservation TTL until provisioning completes', () => {
    const { value, advance } = tracker()
    const reservation = value.reserve('production', 2, 0, 0)
    value.consume(reservation.id, 'production')
    advance(60_000)
    value.pruneExpired()

    expect(value.pendingCount).toBe(1)
    expect(value.cancel(reservation.id, 'production')).toBe(false)
    value.complete(reservation.id)
    expect(value.pendingCount).toBe(0)
  })
})
