import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

type City = [string, string[], string, string, number, number, number, string]
type Dataset = { cities: City[]; regions: Record<string, string> }

export interface WeatherPlace {
  name: string
  admin?: string
  country: string
  timeZone: string
}

interface Location extends WeatherPlace {
  countryCode: string
  regionCode: string
  latitude: number
  longitude: number
  population: number
}

type Resolution =
  | { status: 'not-found' }
  | { status: 'ambiguous'; places: Array<WeatherPlace & { query: string }> }
  | { status: 'found'; location: Location }

const countryNames = new Intl.DisplayNames('en', { type: 'region' })
const unzip = promisify(gunzip)
const countryAliases: Record<string, string[]> = {
  US: ['usa', 'united states of america'],
  GB: ['uk', 'great britain'],
  KR: ['south korea'],
  CZ: ['czech republic'],
  TR: ['turkey'],
  AE: ['uae'],
}

let index: Promise<Map<string, Location[]>> | undefined

function normalize(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/\p{Mark}+/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim()
}

function buildIndex({ cities, regions }: Dataset) {
  const names = new Map<string, Location[]>()
  for (const city of cities) {
    const [name, aliases, countryCode, regionCode, latitude, longitude, population, timeZone] = city
    const region = regions[countryCode + '.' + regionCode]
    const country = countryNames.of(countryCode) ?? countryCode
    const admin = region && normalize(region) !== normalize(name) && normalize(region) !== normalize(country)
      ? region : undefined
    const location = { name, admin, country, countryCode, regionCode, latitude, longitude, population, timeZone }
    for (const key of new Set([name, ...aliases].map(normalize))) {
      if (!key) continue
      const candidates = names.get(key) ?? []
      candidates.push(location)
      names.set(key, candidates)
    }
  }
  return names
}

function matchesQualifiers(location: Location, qualifiers: string[]) {
  if (!qualifiers.length) return true
  const countries = [location.country, location.countryCode, ...(countryAliases[location.countryCode] ?? [])].map(normalize)
  const regions = [location.admin, location.countryCode === 'US' ? location.regionCode : undefined]
    .filter((value): value is string => Boolean(value)).map(normalize)
  const together = regions.flatMap(region => countries.flatMap(country => [region + ' ' + country, country + ' ' + region]))
  return qualifiers.every(qualifier => countries.includes(qualifier) || regions.includes(qualifier) || together.includes(qualifier))
}

export function publicPlace({ name, admin, country, timeZone }: Location): WeatherPlace {
  return { name, ...(admin ? { admin } : {}), country, timeZone }
}

export async function resolveWeatherLocation(input: string): Promise<Resolution> {
  index ??= readFile(new URL('../../../data/search-weather/cities.json.gz', import.meta.url))
    .then(unzip).then(bytes => buildIndex(JSON.parse(bytes.toString('utf8')) as Dataset))
  const names = await index
  const [label = '', ...qualifiers] = input.split(',').map(normalize).filter(Boolean)
  const words = label.split(' ')
  // Try the complete label first, then progressively split off a state or country.
  for (let length = words.length; length > 0; length--) {
    const name = words.slice(0, length).join(' ')
    const suffix = words.slice(length).join(' ')
    const matches = (names.get(name) ?? []).filter(location => matchesQualifiers(location, suffix ? [suffix, ...qualifiers] : qualifiers))
    if (!matches.length) continue
    const canonical = matches.filter(location => normalize(location.name) === name)
    const ranked = (canonical.length ? canonical : matches).sort((a, b) => b.population - a.population)
    const byLabel = new Map<string, Location>()
    for (const city of ranked) {
      const key = [city.name, city.admin, city.country].filter(Boolean).join(', ')
      if (!byLabel.has(key)) byLabel.set(key, city)
    }
    if (byLabel.size === 1) return { status: 'found', location: ranked[0]! }
    return {
      status: 'ambiguous',
      places: [...byLabel].slice(0, 6).map(([query, city]) => ({ ...publicPlace(city), query })),
    }
  }
  return { status: 'not-found' }
}
