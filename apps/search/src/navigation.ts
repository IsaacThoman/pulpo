import type { Category, SearchDate } from './api'

export const MAX_QUERY_LENGTH = 500
export const categories = ['web', 'images', 'news'] as const
export const dateOptions = [
  ['', 'Any time'],
  ['day', 'Past day'],
  ['week', 'Past week'],
  ['month', 'Past month'],
  ['year', 'Past year'],
] as const

export const regions = [
  ['', 'Any region'],
  ['us', 'United States'],
  ['gb', 'United Kingdom'],
  ['au', 'Australia'],
  ['br', 'Brazil'],
  ['ca', 'Canada'],
  ['fr', 'France'],
  ['de', 'Germany'],
  ['in', 'India'],
  ['it', 'Italy'],
  ['jp', 'Japan'],
  ['nl', 'Netherlands'],
  ['es', 'Spain'],
] as const

export interface SearchLocation {
  query: string
  category: Category
  date: SearchDate | ''
  region: string
}

export const homeLocation: SearchLocation = { query: '', category: 'web', date: '', region: '' }

export function parseSearchLocation(url: URL): SearchLocation {
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH)
  if (!query) return homeLocation
  const category = categories.find(value => value === url.searchParams.get('type')) ?? 'web'
  const date = dateOptions.find(([value]) => value === url.searchParams.get('date'))?.[0] ?? ''
  const region = regions.find(([value]) => value === url.searchParams.get('region'))?.[0] ?? ''
  return { query, category, date, region }
}

export function searchPath(input: SearchLocation) {
  if (!input.query) return '/'
  const params = new URLSearchParams({ q: input.query })
  if (input.category !== 'web') params.set('type', input.category)
  if (input.date) params.set('date', input.date)
  if (input.region) params.set('region', input.region)
  return '/search?' + params.toString()
}

export function safeHttpUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url
  } catch {
    return undefined
  }
}
