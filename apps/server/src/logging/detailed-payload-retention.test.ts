import { describe, expect, it, vi } from 'vitest'
import {
  detailedPayloadCaptureIsActive,
  detailedPayloadPolicy,
  reconcileDetailedPayloadRetention,
} from './detailed-payload-retention.js'

const createdAt = new Date('2026-09-03T12:00:00.000Z')

describe('detailed payload retention', () => {
  it('keeps disabled and indefinite policies distinct', () => {
    expect(detailedPayloadPolicy({ logDetailedPayloads: false, payloadRetention: '7d' }, createdAt)).toEqual({
      captureDetailedPayloads: false,
      payloadExpiresAt: null,
    })
    expect(detailedPayloadPolicy({ logDetailedPayloads: true, payloadRetention: 'indefinite' }, createdAt)).toEqual({
      captureDetailedPayloads: true,
      payloadExpiresAt: null,
    })
  })

  it('calculates finite deadlines from request creation time', () => {
    expect(detailedPayloadPolicy({ logDetailedPayloads: true, payloadRetention: '1h' }, createdAt).payloadExpiresAt)
      .toEqual(new Date('2026-09-03T13:00:00.000Z'))
    expect(detailedPayloadPolicy({ logDetailedPayloads: true, payloadRetention: '90d' }, createdAt).payloadExpiresAt)
      .toEqual(new Date('2026-12-02T12:00:00.000Z'))
  })

  it('never treats a disabled or expired request policy as active', () => {
    expect(detailedPayloadCaptureIsActive({ captureDetailedPayloads: false, payloadExpiresAt: null }, createdAt)).toBe(false)
    expect(detailedPayloadCaptureIsActive({ captureDetailedPayloads: true, payloadExpiresAt: createdAt }, createdAt)).toBe(false)
    expect(detailedPayloadCaptureIsActive({
      captureDetailedPayloads: true,
      payloadExpiresAt: new Date(createdAt.getTime() + 1),
    }, createdAt)).toBe(true)
  })

  it('reconciles disabling, indefinite, and finite retention through their required cleanup steps', async () => {
    const execute = vi.fn(async () => undefined)

    await reconcileDetailedPayloadRetention(execute, { logDetailedPayloads: false, payloadRetention: '7d' }, createdAt)
    expect(execute).toHaveBeenCalledTimes(2)

    execute.mockClear()
    await reconcileDetailedPayloadRetention(execute, { logDetailedPayloads: true, payloadRetention: 'indefinite' }, createdAt)
    expect(execute).toHaveBeenCalledTimes(1)

    execute.mockClear()
    await reconcileDetailedPayloadRetention(execute, { logDetailedPayloads: true, payloadRetention: '1h' }, createdAt)
    expect(execute).toHaveBeenCalledTimes(3)
  })
})
