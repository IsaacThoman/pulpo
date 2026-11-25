import { searchDateRange } from '@pulpo/contracts/search'
import { ChevronDown, ListFilter, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { dateOptions, regions, type SearchLocation } from './navigation'

type Filters = Pick<SearchLocation, 'date' | 'dateRange' | 'region'>
type DateSelection = Filters['date'] | 'custom'

interface FilterDraft {
  date: DateSelection
  from: string
  to: string
  region: string
}

interface SearchFiltersProps extends Filters {
  dates: readonly SearchLocation['date'][]
  allowCustomDates: boolean
  allowRegion: boolean
  onApply: (filters: Filters) => void
}

const empty: Filters = { date: '', dateRange: undefined, region: '' }
const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })

function filterDraft({ date, dateRange, region }: Filters): FilterDraft {
  return { date: dateRange ? 'custom' : date, from: dateRange?.from ?? '', to: dateRange?.to ?? '', region }
}

export function SearchFilters({ date, dateRange, region, dates, allowCustomDates, allowRegion, onApply }: SearchFiltersProps) {
  const menu = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  const dateId = useId()
  const fromId = useId()
  const toId = useId()
  const errorId = useId()
  const regionId = useId()
  const [draft, setDraft] = useState(() => filterDraft({ date, dateRange, region }))
  const rangeDraft = draft.date === 'custom' ? searchDateRange(draft.from, draft.to) : undefined
  const reversed = draft.date === 'custom' && !!draft.to && draft.from > draft.to
  const nextDate = draft.date === 'custom' ? '' : draft.date
  const active = Boolean(date || dateRange || region)
  const changed = date !== nextDate || dateRange?.from !== rangeDraft?.from
    || dateRange?.to !== rangeDraft?.to || region !== draft.region
  const valid = draft.date !== 'custom' || !!rangeDraft
  const appliedDateLabel = dateRange ? dateLabel.formatRange(new Date(dateRange.from), new Date(dateRange.to))
    : date && dateOptions.find(([id]) => id === date)?.[1]
  const appliedLabels = [appliedDateLabel, regions.find(([id]) => id === region && region)?.[1]].filter(Boolean).join(' · ')

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

  if (!dates.length && !allowCustomDates && !allowRegion && !active) return null
  return (
    <div className="filter-controls">
      <details className="filter-menu" ref={menu} onKeyDown={event => {
        if (event.key === 'Escape' && event.currentTarget.open) close()
      }}>
        <summary className="filter-trigger" ref={summary} aria-label={active ? 'Filters, ' + appliedLabels : 'Filters'} data-active={active}
          onClick={() => { if (!menu.current?.open) setDraft(filterDraft({ date, dateRange, region })) }}>
          <ListFilter size={16} aria-hidden="true" />
          <span>{appliedLabels || 'Filters'}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <form className="search-filter-form" onSubmit={event => {
          event.preventDefault()
          if (!valid) return
          close()
          if (changed) onApply({ date: nextDate, dateRange: rangeDraft, region: draft.region })
        }}>
          {(dates.length > 0 || allowCustomDates || date || dateRange) && <div className="filter-field">
            <label htmlFor={dateId}>Date range</label>
            <span className="filter-select">
              <select id={dateId} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value as DateSelection })}>
                {dateOptions.filter(([value]) => !value || dates.includes(value) || value === date)
                  .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                {(allowCustomDates || dateRange) && <option value="custom">Custom dates</option>}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>}
          {draft.date === 'custom' && <>
            <div className="filter-field">
              <label htmlFor={fromId}>Start date</label>
              <input id={fromId} type="date" value={draft.from} required
                onChange={event => setDraft({ ...draft, from: event.target.value })} />
            </div>
            <div className="filter-field">
              <label htmlFor={toId}>End date</label>
              <input id={toId} type="date" value={draft.to} required aria-invalid={reversed || undefined}
                aria-describedby={reversed ? errorId : undefined} onChange={event => setDraft({ ...draft, to: event.target.value })} />
              {reversed && <p className="filter-error" id={errorId}>End date must be on or after the start date.</p>}
            </div>
          </>}
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
            <button type="button" className="text-button" onClick={() => setDraft(filterDraft(empty))} disabled={!draft.date && !draft.region}>Reset</button>
            <button className="button" type="submit" disabled={!changed || !valid}>Apply</button>
          </div>
        </form>
      </details>
      {active && <button className="icon-button clear-filters" aria-label="Clear filters" title="Clear filters" onClick={() => onApply(empty)}>
        <X size={16} aria-hidden="true" />
      </button>}
    </div>
  )
}
