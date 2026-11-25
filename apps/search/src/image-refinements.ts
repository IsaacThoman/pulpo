import type { SearchResult } from './api'
import type { ResultWithUrl } from './result-order'

export const imageSizes = [
  ['any', 'Any size'],
  ['small', 'Small (under 640 px)'],
  ['medium', 'Medium (640–1279 px)'],
  ['large', 'Large (1280+ px)'],
] as const

export const imageAspects = [
  ['any', 'Any aspect ratio'],
  ['square', 'Square'],
  ['wide', 'Wide'],
  ['tall', 'Tall'],
  ['panoramic', 'Panoramic (2:1 or wider)'],
] as const

export const imageOrders = [
  ['relevance', 'Relevance'],
  ['largest', 'Largest first'],
  ['newest', 'Newest source dates'],
] as const

export interface ImageRefinements {
  size: typeof imageSizes[number][0]
  aspect: typeof imageAspects[number][0]
  source: string
  order: typeof imageOrders[number][0]
}

export const defaultImageRefinements: ImageRefinements = { size: 'any', aspect: 'any', source: '', order: 'relevance' }

export function hasDimensionFilters(refinements: ImageRefinements) {
  return refinements.size !== 'any' || refinements.aspect !== 'any'
}

export function hasImageFilters(refinements: ImageRefinements) {
  return hasDimensionFilters(refinements) || Boolean(refinements.source)
}

export function hasImageRefinements(refinements: ImageRefinements) {
  return hasImageFilters(refinements) || refinements.order !== 'relevance'
}

export function matchesImageRefinements({ result, host }: ResultWithUrl, refinements: ImageRefinements) {
  if (refinements.source && refinements.source !== host) return false
  if (!hasDimensionFilters(refinements)) return true
  if (!result.imageDimensions) return false
  const { width, height } = result.imageDimensions
  const longest = Math.max(width, height)
  const size = longest < 640 ? 'small' : longest < 1280 ? 'medium' : 'large'
  const aspect = width === height ? 'square' : width > height ? 'wide' : 'tall'
  const matchesAspect = refinements.aspect === 'panoramic' ? width >= 2 * height : refinements.aspect === aspect
  return (refinements.size === 'any' || refinements.size === size)
    && (refinements.aspect === 'any' || matchesAspect)
}

export function imageSources(entries: readonly ResultWithUrl[]) {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.host, (counts.get(entry.host) ?? 0) + 1)
  return [...counts].sort(([left], [right]) => left.localeCompare(right))
}

export function imageSourceTime(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

function imageArea(result: SearchResult) {
  const dimensions = result.imageDimensions
  return dimensions ? dimensions.width * dimensions.height : 0
}

export function orderImageEntries(entries: ResultWithUrl[], order: ImageRefinements['order']) {
  if (order === 'largest') return [...entries].sort((left, right) => imageArea(right.result) - imageArea(left.result))
  if (order === 'newest') {
    // Confirmed source dates precede undated entries, preserving relevance within ties and the undated group.
    return entries.map(entry => ({ entry, time: imageSourceTime(entry.result.publishedAt) }))
      .sort((left, right) => left.time === right.time ? 0 : (right.time ?? -Infinity) - (left.time ?? -Infinity))
      .map(({ entry }) => entry)
  }
  return entries
}
