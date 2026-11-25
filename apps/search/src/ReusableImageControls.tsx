import { ChevronDown } from 'lucide-react'
import { useId, useRef } from 'react'
import { reusableImageCategories, reusableImageLicenses, type ReusableImageFilters } from './reusable-images'
import './reusable-images.css'

const licenseLabels: Record<(typeof reusableImageLicenses)[number], string> = {
  'public-domain': 'Public domain',
  commercial: 'Commercial use allowed',
  modification: 'Adaptations allowed',
}
const categoryLabels: Record<(typeof reusableImageCategories)[number], string> = {
  photograph: 'Photographs',
  illustration: 'Illustrations',
  digitized_artwork: 'Digitized artwork',
}

interface ReusableImageControlsProps {
  active: boolean
  filters: ReusableImageFilters
  onToggle: () => void
  onFilters: (filters: ReusableImageFilters) => void
}

export function ReusableImageControls({ active, filters, onToggle, onFilters }: ReusableImageControlsProps) {
  const id = useId()
  const license = useRef<HTMLSelectElement>(null)
  return (
    <div className="reusable-images">
      <div className="reusable-image-modes" role="group" aria-label="Image search mode">
        <button type="button" className={!active ? 'button' : 'secondary-button'} aria-pressed={!active}
          onClick={() => { if (active) onToggle() }}>All images</button>
        <button type="button" className={active ? 'button' : 'secondary-button'} aria-pressed={active}
          onClick={() => { if (!active) onToggle() }}>Reusable images</button>
      </div>
      {active && <>
        <p className="reusable-image-credit"><strong>Made with <a href="https://openverse.org/" rel="noreferrer">Openverse</a>.</strong>{' '}
          Pulpo operates this feature independently, without Openverse endorsement or certification.</p>
        <fieldset className="reusable-image-filters">
          <legend className="sr-only">Reusable image filters</legend>
          <div className="filter-field">
            <label htmlFor={id + '-license'}>License</label>
            <span className="filter-select">
              <select ref={license} id={id + '-license'} value={filters.license ?? ''} onChange={event => {
                const option = reusableImageLicenses.find(value => value === event.target.value)
                onFilters({ ...filters, license: option })
              }}>
                <option value="">All open licenses</option>
                {reusableImageLicenses.map(value => <option key={value} value={value}>{licenseLabels[value]}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="filter-field">
            <label htmlFor={id + '-category'}>Image type</label>
            <span className="filter-select">
              <select id={id + '-category'} value={filters.category ?? ''} onChange={event => {
                const option = reusableImageCategories.find(value => value === event.target.value)
                onFilters({ ...filters, category: option })
              }}>
                <option value="">All image types</option>
                {reusableImageCategories.map(value => <option key={value} value={value}>{categoryLabels[value]}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>
          {(filters.license || filters.category) && <button type="button" className="text-button reusable-image-reset" onClick={() => {
            license.current?.focus()
            onFilters({})
          }}>Reset filters</button>}
        </fieldset>
      </>}
    </div>
  )
}
