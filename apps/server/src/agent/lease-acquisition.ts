import type { RequestInit } from 'undici'
import { isCapacityReservationInvalidResponse, isCapacityReservationUnsupportedResponse, isWorkspaceCapacityResponse } from './capacity.js'

export class ControllerRequestError extends Error {
  constructor(readonly status: number, readonly responseBody: string) {
    super(`Workspace controller request failed (${status}): ${responseBody}`)
  }
}

function isCapacityError(error: unknown): boolean {
  return error instanceof ControllerRequestError && isWorkspaceCapacityResponse(error.status, error.responseBody)
}

function isCapacityReservationInvalid(error: unknown): boolean {
  return error instanceof ControllerRequestError && isCapacityReservationInvalidResponse(error.status, error.responseBody)
}

function isCapacityReservationUnsupported(error: unknown): boolean {
  return error instanceof ControllerRequestError && isCapacityReservationUnsupportedResponse(error.status)
}

type ControllerRequest = (path: string, init?: RequestInit) => Promise<Response>

export type WorkspaceLeaseAttempt = {
  request: ControllerRequest
  signal?: AbortSignal
  capacityReservationsSupported?: boolean
  maxActiveWorkspaces: number
  leaseInput: Record<string, unknown>
  onProvisioning: () => Promise<void>
}

export type WorkspaceLeaseAttemptResult = {
  kind: 'ready'
  leaseId: string
  capacityReservationsSupported: boolean
} | {
  kind: 'waiting'
  publicStateChanged: boolean
  capacityReservationsSupported?: boolean
}

export async function attemptWorkspaceLease(input: WorkspaceLeaseAttempt): Promise<WorkspaceLeaseAttemptResult> {
  let capacityReservationsSupported = input.capacityReservationsSupported
  let capacityReservationId: string | undefined
  try {
    if (capacityReservationsSupported !== false) {
      try {
        const response = await input.request('/v1/capacity-reservations', {
          method: 'POST', signal: input.signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ maxActiveWorkspaces: input.maxActiveWorkspaces }),
        })
        const reservation = await response.json() as { id?: unknown }
        if (typeof reservation.id !== 'string' || !reservation.id) throw new Error('Workspace controller returned an invalid capacity reservation')
        capacityReservationId = reservation.id
        capacityReservationsSupported = true
      } catch (error) {
        if (!isCapacityReservationUnsupported(error)) throw error
        capacityReservationsSupported = false
      }
    }

    if (capacityReservationId) await input.onProvisioning()
    const response = await input.request('/v1/leases', {
      method: 'POST', signal: input.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input.leaseInput, ...(capacityReservationId ? { capacityReservationId } : {}) }),
    })
    const lease = await response.json() as { id?: unknown }
    if (typeof lease.id !== 'string' || !lease.id) throw new Error('Workspace controller returned an invalid lease')
    return { kind: 'ready', leaseId: lease.id, capacityReservationsSupported: capacityReservationsSupported ?? false }
  } catch (error) {
    if (isCapacityError(error) || isCapacityReservationInvalid(error)) {
      return {
        kind: 'waiting',
        publicStateChanged: Boolean(capacityReservationId),
        ...(capacityReservationsSupported !== undefined ? { capacityReservationsSupported } : {}),
      }
    }
    throw error
  } finally {
    if (capacityReservationId) {
      await input.request(`/v1/capacity-reservations/${encodeURIComponent(capacityReservationId)}`, {
        method: 'DELETE', signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined)
    }
  }
}
