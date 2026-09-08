import { describe, expect, it } from 'vitest'
import { generationTimeContext, TIME_CONTEXT_INSTRUCTIONS, withGenerationTimeContext } from './time-context.js'

const response = { origin: 'web', timeZone: 'America/New_York' }
const start = Date.parse('2026-09-08T01:15:00Z')

describe('generation time context', () => {
  it('uses the previous local day when UTC has crossed midnight', () => {
    expect(generationTimeContext(response, start)).toBe([
      'User timezone: America/New_York',
      'Local date: Monday, September 7, 2026',
      'Local time: 9:15 PM EDT',
    ].join('\n'))
  })

  it.each([
    ['2026-03-08T06:30:00Z', '1:30 AM EST'],
    ['2026-03-08T07:30:00Z', '3:30 AM EDT'],
    ['2026-11-01T05:30:00Z', '1:30 AM EDT'],
    ['2026-11-01T06:30:00Z', '1:30 AM EST'],
  ])('handles the daylight saving boundary at %s', (instant, expected) => {
    expect(generationTimeContext(response, Date.parse(instant))).toContain(`Local time: ${expected}`)
  })

  it('supports zones ahead of UTC', () => {
    const context = generationTimeContext({ ...response, timeZone: 'Asia/Tokyo' }, Date.parse('2026-09-07T16:15:00Z'))
    expect(context).toContain('Local date: Tuesday, September 8, 2026')
    expect(context).toContain('Local time: 1:15 AM')
  })

  it.each([undefined, null, 'Mars/Olympus_Mons'])('labels UTC explicitly when timezone is unavailable: %s', (timeZone) => {
    const context = generationTimeContext({ ...response, timeZone }, start)
    expect(context).toContain('User timezone: unknown')
    expect(context).toContain('UTC date: Tuesday, September 8, 2026')
    expect(context).not.toContain('Local date:')
  })

  it('uses generation start rather than the queued message timestamp', () => {
    const queued = { ...response, createdAt: new Date('2026-09-08T03:59:00Z') }
    const context = generationTimeContext(queued, Date.parse('2026-09-08T04:01:00Z'))
    expect(context).toContain('Tuesday, September 8, 2026')
    expect(context).toContain('12:01 AM EDT')
  })

  it('replaces saved date context on retries and agent resume without changing the base prompt', () => {
    const saved = withGenerationTimeContext('Model policy\n\nAccount memory', response, start)
    const resumed = withGenerationTimeContext(saved, response, Date.parse('2026-09-08T04:01:00Z'))
    expect(resumed).toContain('Model policy\n\nAccount memory')
    expect(resumed).toContain('Tuesday, September 8, 2026')
    expect(resumed).not.toContain('Monday, September 7, 2026')
    expect(resumed.split('[Pulpo generation time context]')).toHaveLength(2)
    expect(resumed.split(TIME_CONTEXT_INSTRUCTIONS)).toHaveLength(2)
    expect(withGenerationTimeContext(resumed, response, Date.parse('2026-09-08T04:01:00Z'))).toBe(resumed)
  })

  it('keeps public API prompts unchanged and removes any previously saved first-party context', () => {
    const api = { ...response, origin: 'api' }
    expect(generationTimeContext(api, start)).toBe('')
    expect(withGenerationTimeContext('Caller instructions', api, start)).toBe('Caller instructions')
    const saved = withGenerationTimeContext('Caller instructions', response, start)
    expect(withGenerationTimeContext(saved, api, start)).toBe('Caller instructions')
  })

  it('includes context for administrator chat access', () => {
    expect(generationTimeContext({ ...response, origin: 'admin_chat' }, start)).toContain('Monday, September 7')
  })
})
