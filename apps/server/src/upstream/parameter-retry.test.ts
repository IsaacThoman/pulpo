import { describe, expect, it } from 'vitest'
import { rejectedOptionalParameter, withoutKey } from './parameter-retry.js'

function apiError(status: number, message: string, param?: string) {
  return Object.assign(new Error(`${status} ${message}`), { status, error: { message, ...(param ? { param } : {}) } })
}

const optional = new Set(['temperature', 'top_p', 'response_format', 'reasoning_effort'])
const body = { model: 'm', temperature: 0.2, top_p: 0.9, response_format: { type: 'json_schema' }, reasoning_effort: 'low' }

describe('rejectedOptionalParameter', () => {
  it.each([
    "Unsupported parameter: 'temperature' is not supported with this model.",
    'temperature: not supported',
    '`temperature` is deprecated for this model',
    'Unknown parameter: temperature',
    'temperature: Extra inputs are not permitted',
    'Unrecognized request argument supplied: temperature',
    'This model does not support temperature',
    'temperature is no longer supported',
  ])('strips when the message says the field is unsupported: %s', (message) => {
    expect(rejectedOptionalParameter(apiError(400, message), body, optional)).toBe('temperature')
  })

  it('does not strip invalid values or schemas, even when param names the key', () => {
    expect(rejectedOptionalParameter(apiError(400, "Invalid schema for response_format 'out': missing 'type'", 'response_format'), body, optional)).toBeUndefined()
    expect(rejectedOptionalParameter(apiError(400, 'temperature must be between 0 and 2', 'temperature'), body, optional)).toBeUndefined()
    expect(rejectedOptionalParameter(apiError(400, 'top_p: value out of range'), body, optional)).toBeUndefined()
  })

  it('prefers the named param, then the earliest key in the message', () => {
    expect(rejectedOptionalParameter(apiError(400, 'top_p and temperature are not supported', 'temperature'), body, optional)).toBe('temperature')
    expect(rejectedOptionalParameter(apiError(400, 'top_p and temperature are not supported'), body, optional)).toBe('top_p')
    expect(rejectedOptionalParameter(apiError(422, 'reasoning_effort.level is not supported', 'reasoning_effort.level'), body, optional)).toBe('reasoning_effort')
  })

  it('ignores non-400/422 errors, keys absent from the body, and non-optional keys', () => {
    expect(rejectedOptionalParameter(apiError(500, 'temperature not supported'), body, optional)).toBeUndefined()
    expect(rejectedOptionalParameter(apiError(400, 'temperature not supported'), { model: 'm' }, optional)).toBeUndefined()
    expect(rejectedOptionalParameter(apiError(400, 'model not supported', 'model'), body, optional)).toBeUndefined()
    // Whole-word matches only: `temperature_x` does not name `temperature`.
    expect(rejectedOptionalParameter(apiError(400, 'temperature_x is not supported'), body, optional)).toBeUndefined()
  })
})

describe('withoutKey', () => {
  it('returns a copy without the key', () => {
    const source = { a: 1, b: 2 }
    expect(withoutKey(source, 'a')).toEqual({ b: 2 })
    expect(source).toEqual({ a: 1, b: 2 })
  })
})
