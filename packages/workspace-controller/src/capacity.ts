import { randomUUID } from 'node:crypto'

export type WorkspaceCapacityScope = 'instance' | 'controller'

export class WorkspaceCapacityError extends Error {
  readonly code = 'workspace_capacity_exhausted'

  constructor(readonly scope: WorkspaceCapacityScope) {
    super(scope === 'instance'
      ? 'Maximum active workspace capacity reached for this Pulpo instance'
      : 'Maximum active workspace capacity reached for this workspace controller')
  }
}

export class CapacityReservationError extends Error {
  readonly code = 'workspace_capacity_reservation_invalid'

  constructor() {
    super('Workspace capacity reservation is missing, expired, already consumed, or owned by another Pulpo instance')
  }
}

export type CapacityReservation = {
  id: string
  instanceId: string
  expiresAt: number
  state: 'reserved' | 'consumed'
}

type CapacityTrackerOptions = {
  maxActiveTotal: number
  reservationTtlMs?: number
  now?: () => number
  newId?: () => string
}

export class CapacityTracker {
  private readonly reservations = new Map<string, CapacityReservation>()
  private readonly pendingByInstance = new Map<string, number>()
  private pendingTotal = 0
  private readonly reservationTtlMs: number
  private readonly now: () => number
  private readonly newId: () => string

  constructor(private readonly options: CapacityTrackerOptions) {
    this.reservationTtlMs = options.reservationTtlMs ?? 30_000
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? randomUUID
  }

  reserve(instanceId: string, maxActiveForInstance: number, activeForInstance: number, activeTotal: number): CapacityReservation {
    this.pruneExpired()
    const perInstanceLimit = Math.max(1, maxActiveForInstance)
    const ownerPending = this.pendingByInstance.get(instanceId) ?? 0
    if (activeForInstance + ownerPending >= perInstanceLimit) throw new WorkspaceCapacityError('instance')
    if (activeTotal + this.pendingTotal >= this.options.maxActiveTotal) throw new WorkspaceCapacityError('controller')

    const reservation: CapacityReservation = {
      id: this.newId(),
      instanceId,
      expiresAt: this.now() + this.reservationTtlMs,
      state: 'reserved',
    }
    this.reservations.set(reservation.id, reservation)
    this.pendingByInstance.set(instanceId, ownerPending + 1)
    this.pendingTotal += 1
    return { ...reservation }
  }

  consume(id: string, instanceId: string): CapacityReservation {
    const reservation = this.reservations.get(id)
    if (!reservation || reservation.instanceId !== instanceId || reservation.state !== 'reserved') {
      throw new CapacityReservationError()
    }
    if (reservation.expiresAt <= this.now()) {
      this.complete(id)
      throw new CapacityReservationError()
    }
    reservation.state = 'consumed'
    return { ...reservation }
  }

  cancel(id: string, instanceId: string): boolean {
    const reservation = this.reservations.get(id)
    if (!reservation || reservation.instanceId !== instanceId || reservation.state !== 'reserved') return false
    this.complete(id)
    return true
  }

  complete(id: string): void {
    const reservation = this.reservations.get(id)
    if (!reservation) return
    this.reservations.delete(id)
    const ownerPending = this.pendingByInstance.get(reservation.instanceId) ?? 1
    if (ownerPending <= 1) this.pendingByInstance.delete(reservation.instanceId)
    else this.pendingByInstance.set(reservation.instanceId, ownerPending - 1)
    this.pendingTotal = Math.max(0, this.pendingTotal - 1)
  }

  pruneExpired(): void {
    const now = this.now()
    for (const reservation of this.reservations.values()) {
      if (reservation.state === 'reserved' && reservation.expiresAt <= now) this.complete(reservation.id)
    }
  }

  get pendingCount(): number { return this.pendingTotal }
  pendingForInstance(instanceId: string): number { return this.pendingByInstance.get(instanceId) ?? 0 }
}
