import { describe, expect, it } from 'vitest'
import { backgroundRequestParameter } from './upstream-request.js'

describe('backgroundRequestParameter', () => {
  it('omits the background parameter for streaming execution', () => {
    expect(backgroundRequestParameter('stream')).toEqual({})
    expect(backgroundRequestParameter('stream')).not.toHaveProperty('background')
  })

  it('enables the background parameter for background execution', () => {
    expect(backgroundRequestParameter('background')).toEqual({ background: true })
  })
})
