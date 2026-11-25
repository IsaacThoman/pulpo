import { ChevronDown, ListFilter, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { dateOptions, regions, type SearchLocation } from './navigation'

type Filters = Pick<SearchLocation, 'date' | 'region'>

interface SearchFiltersProps extends Filters {
  dates: readonly SearchLocation['date'][]
  allowRegion: boolean
  onApply: (filters: Filters) => void
}

const empty: Filters = { date: '', region: '' }

export function SearchFilters({ date, region, dates, allowRegion, onApply }: SearchFiltersProps) {
  const menu = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  const dateId = useId()
  const regionId = useId()
  const [draft, setDraft] = useState<Filters>({ date, region })
  const active = Boolean(date || region)
  const changed = date !== draft.date || region !== draft.region
  const appliedLabels = [dateOptions.find(([id]) => id === date && date)?.[1], regions.find(([id]) => id === region && region)?.[1]]
    .filter(Boolean).join(' · ')

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const element = menu.current
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) element.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])

  function close() {
    if (menu.current) menu.current.open = false
    summary.current?.focus()
  }

  if (!dates.length && !allowRegion && !active) return null
  return (
    <div className="filter-controls">
      <details className="filter-menu" ref={menu} onKeyDown={event => {
        if (event.key === 'Escape' && event.currentTarget.open) close()
      }}>
        <summary className="filter-trigger" ref={summary} aria-label={active ? 'Filters, ' + appliedLabels : 'Filters'} data-active={active}
          onClick={() => { if (!menu.current?.open) setDraft({ date, region }) }}>
          <ListFilter size={16} aria-hidden="true" />
          <span>{appliedLabels || 'Filters'}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <form className="search-filter-form" onSubmit={event => {
          event.preventDefault()
          close()
          if (changed) onApply(draft)
        }}>
          {dates.length > 0 && <div className="filter-field">
            <label htmlFor={dateId}>Date range</label>
            <span className="filter-select">
              <select id={dateId} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value as SearchLocation['date'] })}>
                {dateOptions.filter(([value]) => !value || dates.includes(value) || value === date)
                  .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>}
          {allowRegion && <div className="filter-field">
            <label htmlFor={regionId}>Region</label>
            <span className="filter-select">
              <select id={regionId} value={draft.region} onChange={event => setDraft({ ...draft, region: event.target.value })}>
                {regions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>}
          <div className="filter-actions">
            <button type="button" className="text-button" onClick={() => setDraft(empty)} disabled={!draft.date && !draft.region}>Reset</button>
            <button className="button" type="submit" disabled={!changed}>Apply</button>
          </div>
        </form>
      </details>
      {active && <button className="icon-button clear-filters" aria-label="Clear filters" title="Clear filters" onClick={() => onApply(empty)}>
        <X size={16} aria-hidden="true" />
      </button>}
    </div>
  )
}
