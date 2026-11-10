import { describe, expect, it } from 'vitest'
import { analyticsRangeQuerySchema, CLIENT_FEATURES_HEADER_VALUE, parseClientFeaturesHeader, parseClientPlatformHeader } from './admin-analytics.js'

describe('client platform header', () => {
  it('parses platforms with optional versions', () => {
    expect(parseClientPlatformHeader('desktop')).toEqual({ platform: 'desktop', version: null })
    expect(parseClientPlatformHeader('Android/2.0.1-beta')).toEqual({ platform: 'android', version: '2.0.1-beta' })
    expect(parseClientPlatformHeader('web/<script>')).toEqual({ platform: 'web', version: null })
  })

  it('rejects unknown and server-only platforms', () => {
    expect(parseClientPlatformHeader('toaster')).toBeNull()
    expect(parseClientPlatformHeader('api')).toBeNull()
    expect(parseClientPlatformHeader(undefined)).toBeNull()
  })
})

describe('client features header', () => {
  it('keeps the features this server knows', () => {
    expect(parseClientFeaturesHeader(CLIENT_FEATURES_HEADER_VALUE)).toEqual(['files-permission'])
    expect(parseClientFeaturesHeader(' Files-Permission ,future-thing')).toEqual(['files-permission'])
    expect(parseClientFeaturesHeader('future-thing')).toEqual([])
    expect(parseClientFeaturesHeader(undefined)).toEqual([])
  })
})

describe('analytics range query', () => {
  it('requires a start for custom ranges and validates time zones', () => {
    expect(analyticsRangeQuerySchema.safeParse({ range: 'custom' }).success).toBe(false)
    expect(analyticsRangeQuerySchema.safeParse({ range: '7d', timeZone: 'Not/AZone' }).success).toBe(false)
    expect(analyticsRangeQuerySchema.parse({})).toEqual({ range: '24h', timeZone: 'UTC' })
  })
})
