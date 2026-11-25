import { useEffect, useState } from 'react'
import type { SearchResponse } from './api'
import { defaultImageRefinements, type ImageRefinements } from './image-refinements'

export function useImageBrowse(key: string | undefined, page: number, response: SearchResponse | undefined) {
  const [pages, setPages] = useState<{ key: string; images: Map<number, Set<string>> }>()
  const [refinement, setRefinement] = useState<{ key: string; value: ImageRefinements }>()
  const data = key ? response : undefined
  useEffect(() => {
    if (!key || !data) return
    const urls = new Set(data.results.flatMap(result => result.imageUrl ? [result.imageUrl] : []))
    setPages(previous => ({
      key,
      images: new Map(previous?.key === key ? previous.images : []).set(page, urls),
    }))
  }, [data, key, page])

  const previouslySeen = key && pages?.key === key
    ? new Set([...pages.images].filter(([number]) => number < page).flatMap(([, urls]) => [...urls]))
    : undefined
  return {
    data: data && previouslySeen
      ? { ...data, results: data.results.filter(result => !result.imageUrl || !previouslySeen.has(result.imageUrl)) }
      : data,
    refinements: key ? {
      value: refinement?.key === key ? refinement.value : defaultImageRefinements,
      update: (value: ImageRefinements) => setRefinement({ key, value }),
    } : undefined,
  }
}
