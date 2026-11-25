import { describe, expect, it } from 'vitest'
import { resolveWeatherLocation } from './geocoder.js'

describe('Local weather gazetteer', () => {
  it('disambiguates same-named cities with repeatable qualified choices', async () => {
    const result = await resolveWeatherLocation('Paris')
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') return
    expect(result.places).toContainEqual(expect.objectContaining({ name: 'Paris', country: 'France' }))
    expect(result.places).toContainEqual(expect.objectContaining({ name: 'Paris', admin: 'Texas', country: 'United States' }))
    for (const choice of result.places) {
      expect(await resolveWeatherLocation(choice.query)).toMatchObject({
        status: 'found', location: { name: choice.name, country: choice.country },
      })
    }
  })

  it.each([
    ['Atlanta, GA', 'US', 'America/New_York'],
    ['NYC', 'US', 'America/New_York'],
    ['Paris, Texas, USA', 'US', 'America/Chicago'],
    ['London England', 'GB', 'Europe/London'],
    ['Tokyo, Japan', 'JP', 'Asia/Tokyo'],
    ['Lima, Peru', 'PE', 'America/Lima'],
  ])('resolves an explicit city, state, country, or familiar alias: %s', async (query, countryCode, timeZone) => {
    expect(await resolveWeatherLocation(query)).toMatchObject({ status: 'found', location: { countryCode, timeZone } })
  })

  it('leaves unspecified, incorrect, and unsupported locations unresolved', async () => {
    for (const query of ['near me', 'Paris, California', '', 'arbitrary user content']) {
      expect(await resolveWeatherLocation(query)).toEqual({ status: 'not-found' })
    }
  })
})
