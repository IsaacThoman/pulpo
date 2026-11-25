import { ChevronDown } from 'lucide-react'
import { useId, useRef } from 'react'
import { defaultImageRefinements, hasImageRefinements, imageAspects, imageSizes, type ImageRefinements } from './image-refinements'

interface ImageResultFiltersProps {
  value: ImageRefinements
  update: (value: ImageRefinements) => void
  shown: number
  total: number
  withoutDimensions: number
}

export function ImageResultFilters({ value, update, shown, total, withoutDimensions }: ImageResultFiltersProps) {
  const size = useRef<HTMLSelectElement>(null)
  const id = useId()
  const active = hasImageRefinements(value)

  return (
    <fieldset className="image-refinements">
      <legend>Filter these results</legend>
      <div className="image-refinement-fields">
        <div className="filter-field">
          <label htmlFor={id + '-size'}>Size</label>
          <span className="filter-select">
            <select id={id + '-size'} ref={size} value={value.size} aria-describedby={id + '-hint'} onChange={event => {
              const next = imageSizes.find(([id]) => id === event.target.value)?.[0] ?? 'any'
              update({ ...value, size: next })
            }}>
              {imageSizes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </div>
        <div className="filter-field">
          <label htmlFor={id + '-aspect'}>Aspect ratio</label>
          <span className="filter-select">
            <select id={id + '-aspect'} value={value.aspect} onChange={event => {
              const next = imageAspects.find(([id]) => id === event.target.value)?.[0] ?? 'any'
              update({ ...value, aspect: next })
            }}>
              {imageAspects.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </div>
        {active && <button type="button" className="text-button image-refinement-clear" onClick={() => {
          size.current?.focus()
          update(defaultImageRefinements)
        }}>Clear image filters</button>}
      </div>
      <span id={id + '-hint'} className="sr-only">Size is measured along the longest side.</span>
      {active && <p className="image-refinement-summary">
        {shown} of {total} {total === 1 ? 'image' : 'images'} shown
        {withoutDimensions > 0 && ' · ' + withoutDimensions + ' without reported dimensions'}
      </p>}
    </fieldset>
  )
}
