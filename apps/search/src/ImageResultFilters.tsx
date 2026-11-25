import { ChevronDown, ListFilter } from 'lucide-react'
import { useId, useRef } from 'react'
import {
  defaultImageRefinements, hasDimensionFilters, hasImageRefinements, imageAspects, imageOrders, imageSizes, type ImageRefinements,
} from './image-refinements'

interface ImageResultFiltersProps {
  value: ImageRefinements
  update: (value: ImageRefinements) => void
  shown: number
  total: number
  matches: number
  withoutDimensions: number
  hasSourceDates: boolean
  sources: Array<[string, number]>
}

export function ImageResultFilters({ value, update, shown, total, matches, withoutDimensions, hasSourceDates, sources }: ImageResultFiltersProps) {
  const fieldset = useRef<HTMLFieldSetElement>(null)
  const id = useId()
  const active = hasImageRefinements(value)
  const hasDimensions = withoutDimensions < total
  const showDimensions = hasDimensions || hasDimensionFilters(value)
  const showSources = sources.length > 1 || Boolean(value.source)
  const orders = imageOrders.filter(([order]) => (
    order === 'relevance' || order === value.order || (order === 'largest' ? hasDimensions : hasSourceDates)
  ))

  if (!showDimensions && !showSources && orders.length < 2) return null

  const controls = (
    <fieldset className="image-refinements" ref={fieldset}>
      <legend className="sr-only">Filter these results</legend>
      <div className="image-refinement-fields">
        {showDimensions && <>
          <div className="filter-field">
            <label htmlFor={id + '-size'}>Size</label>
            <span className="filter-select">
              <select id={id + '-size'} value={value.size} aria-describedby={id + '-hint'} onChange={event => {
                const next = imageSizes.find(([option]) => option === event.target.value)?.[0] ?? 'any'
                update({ ...value, size: next })
              }}>
                {imageSizes.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="filter-field">
            <label htmlFor={id + '-aspect'}>Aspect ratio</label>
            <span className="filter-select">
              <select id={id + '-aspect'} value={value.aspect} onChange={event => {
                const next = imageAspects.find(([option]) => option === event.target.value)?.[0] ?? 'any'
                update({ ...value, aspect: next })
              }}>
                {imageAspects.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>
        </>}
        {showSources && (
          <div className="filter-field">
            <label htmlFor={id + '-source'}>Source</label>
            <span className="filter-select">
              <select id={id + '-source'} value={value.source} onChange={event => update({ ...value, source: event.target.value })}>
                <option value="">All sources</option>
                {value.source && !sources.some(([host]) => host === value.source) && <option value={value.source}>{value.source} (0)</option>}
                {sources.map(([host, count]) => <option key={host} value={host}>{host} ({count})</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>
        )}
        {orders.length > 1 && (
          <div className="filter-field">
            <label htmlFor={id + '-order'}>Order</label>
            <span className="filter-select">
              <select id={id + '-order'} value={value.order} onChange={event => {
                const next = orders.find(([option]) => option === event.target.value)?.[0] ?? 'relevance'
                update({ ...value, order: next })
              }}>
                {orders.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>
        )}
      </div>
      {showDimensions && <span id={id + '-hint'} className="sr-only">Size is measured along the longest side.</span>}
      {(active || shown < total) && <div className="image-refinement-status">
        <p className="image-refinement-summary">
          {shown} of {total} {total === 1 ? 'image' : 'images'} shown
          {matches > shown && matches < total && ' · ' + matches + ' match'}
          {hasDimensionFilters(value) && withoutDimensions > 0 && ' · ' + withoutDimensions + ' without reported dimensions'}
        </p>
        {active && <button type="button" className="text-button image-refinement-clear" onClick={() => {
          fieldset.current?.querySelector('select')?.focus()
          update(defaultImageRefinements)
        }}>Clear image filters</button>}
      </div>}
    </fieldset>
  )
  return <details className="image-refinements-menu" onKeyDown={event => {
    const menu = event.currentTarget
    if (event.key !== 'Escape' || !menu.open) return
    menu.open = false
    menu.querySelector('summary')?.focus()
  }}>
    <summary className="text-button">
      <ListFilter className="image-refinement-icon" size={15} aria-hidden="true" />
      {active ? 'Image filters applied' : 'Refine images'} <ChevronDown size={14} aria-hidden="true" />
    </summary>
    {controls}
  </details>
}
