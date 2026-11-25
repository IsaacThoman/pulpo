import { useState } from 'react'
import { defaultImageRefinements, type ImageRefinements } from './image-refinements'

/** Image refinements for one search, kept while more images load. */
export function useImageRefinements(key: string | undefined) {
  const [refinement, setRefinement] = useState<{ key: string; value: ImageRefinements }>()
  return key ? {
    value: refinement?.key === key ? refinement.value : defaultImageRefinements,
    update: (value: ImageRefinements) => setRefinement({ key, value }),
  } : undefined
}
