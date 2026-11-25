import type { SearchResult } from './api'

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
] as const

export interface ImageRefinements {
  size: typeof imageSizes[number][0]
  aspect: typeof imageAspects[number][0]
}

export const defaultImageRefinements: ImageRefinements = { size: 'any', aspect: 'any' }

export function hasImageRefinements(refinements: ImageRefinements) {
  return refinements.size !== 'any' || refinements.aspect !== 'any'
}

export function matchesImageRefinements(result: SearchResult, refinements: ImageRefinements) {
  if (!hasImageRefinements(refinements)) return true
  if (!result.imageDimensions) return false
  const { width, height } = result.imageDimensions
  const longest = Math.max(width, height)
  const size = longest < 640 ? 'small' : longest < 1280 ? 'medium' : 'large'
  const aspect = width === height ? 'square' : width > height ? 'wide' : 'tall'
  return (refinements.size === 'any' || refinements.size === size)
    && (refinements.aspect === 'any' || refinements.aspect === aspect)
}
