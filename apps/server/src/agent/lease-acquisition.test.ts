import { describe, expect, it, vi } from 'vitest'
import type { RequestInit } from 'undici'
import { attemptWorkspaceLease, ControllerRequestError } from './lease-acquisition.js'

const leaseInput = { chatId: 'chat-1', imageDigest: `ghcr.io/example/workspace@sha256:${'a'.repeat(64)}` }
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('workspace lease acquisition events', () => {
  it('keeps repeated capacity failures in the waiting public state', async () => {
    const events = ['waiting']
    const request = vi.fn(async () => {
      throw new ControllerRequestError(503, JSON.stringify({ code: 'workspace_capacity_exhausted', scope: 'instance' }))
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await attemptWorkspaceLease({
        request,
        maxActiveWorkspaces: 3,
        leaseInput,
        onProvisioning: async () => { events.push('provisioning') },
      })
      expect(result).toMatchObject({ kind: 'waiting', publicStateChanged: false })
    }

    expect(events).toEqual(['waiting'])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('emits provisioning once after reservation acceptance and returns the lease', async () => {
    const events = ['waiting']
    const paths: string[] = []
    const request = vi.fn(async (path: string, _init?: RequestInit) => {
      paths.push(path)
      if (path === '/v1/capacity-reservations') return json({ id: 'reservation-1' })
      if (path === '/v1/leases') return json({ id: 'lease-1' })
      return json({ status: 'not_released' })
    })

    const result = await attemptWorkspaceLease({
      request,
      maxActiveWorkspaces: 3,
      leaseInput,
      onProvisioning: async () => { events.push('provisioning') },
    })

    expect(result).toEqual({ kind: 'ready', leaseId: 'lease-1', capacityReservationsSupported: true })
    if (result.kind === 'ready') events.push('ready')
    expect(events).toEqual(['waiting', 'provisioning', 'ready'])
    expect(paths).toEqual(['/v1/capacity-reservations', '/v1/leases', '/v1/capacity-reservations/reservation-1'])
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toMatchObject({ capacityReservationId: 'reservation-1' })
  })

  it('returns to waiting when an accepted reservation is invalidated', async () => {
    const events = ['waiting']
    const request = vi.fn(async (path: string) => {
      if (path === '/v1/capacity-reservations') return json({ id: 'reservation-1' })
      if (path === '/v1/leases') {
        throw new ControllerRequestError(409, JSON.stringify({ code: 'workspace_capacity_reservation_invalid' }))
      }
      return json({ status: 'not_released' })
    })

    const result = await attemptWorkspaceLease({
      request,
      maxActiveWorkspaces: 3,
      leaseInput,
      onProvisioning: async () => { events.push('provisioning') },
    })

    expect(result).toEqual({ kind: 'waiting', publicStateChanged: true, capacityReservationsSupported: true })
    if (result.kind === 'waiting' && result.publicStateChanged) events.push('waiting')
    expect(events).toEqual(['waiting', 'provisioning', 'waiting'])
    expect(request).toHaveBeenLastCalledWith('/v1/capacity-reservations/reservation-1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('caches legacy fallback without emitting speculative provisioning', async () => {
    const events = ['waiting']
    const paths: string[] = []
    const request = vi.fn(async (path: string) => {
      paths.push(path)
      if (path === '/v1/capacity-reservations') throw new ControllerRequestError(404, '{"error":"lease_not_found"}')
      throw new ControllerRequestError(503, '{"error":"Maximum active workspace capacity reached"}')
    })

    const first = await attemptWorkspaceLease({
      request,
      maxActiveWorkspaces: 3,
      leaseInput,
      onProvisioning: async () => { events.push('provisioning') },
    })
    const second = await attemptWorkspaceLease({
      request,
      capacityReservationsSupported: first.capacityReservationsSupported,
      maxActiveWorkspaces: 3,
      leaseInput,
      onProvisioning: async () => { events.push('provisioning') },
    })

    expect(first).toEqual({ kind: 'waiting', publicStateChanged: false, capacityReservationsSupported: false })
    expect(second).toEqual({ kind: 'waiting', publicStateChanged: false, capacityReservationsSupported: false })
    expect(events).toEqual(['waiting'])
    expect(paths).toEqual(['/v1/capacity-reservations', '/v1/leases', '/v1/leases'])
  })
})
