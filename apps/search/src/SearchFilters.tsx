import { searchDateRange } from '@pulpo/contracts/search'
import { ChevronDown, ListFilter, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { providerNames, type Provider } from './api'
import { dateOptions, regions, type SearchLocation } from './navigation'

type Filters = Pick<SearchLocation, 'date' | 'dateRange' | 'region' | 'regionOverride' | 'safeSearch'>
type DateSelection = Filters['date'] | 'custom'

interface FilterDraft {
  date: DateSelection
  from: string
  to: string
  region: string
  safeSearch: string
}

interface SearchFiltersProps extends Filters {
  dates: readonly SearchLocation['date'][]
  allowCustomDates: boolean
  allowRegion: boolean
  defaultRegion: string
  defaultSafeSearch: boolean
  onApply: (filters: Filters) => void
  searchProvider?: {
    selected: Provider | undefined
    used: Provider | undefined
    choices: Provider[]
    onChange: (value: Provider | undefined) => void
  }
}

const empty: Filters = { date: '', dateRange: undefined, region: '', regionOverride: undefined, safeSearch: undefined }
const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })

function filterDraft({ date, dateRange, region, regionOverride, safeSearch }: Filters): FilterDraft {
  return {
    date: dateRange ? 'custom' : date, from: dateRange?.from ?? '', to: dateRange?.to ?? '',
    region: regionOverride ? 'any' : region, safeSearch: safeSearch === undefined ? '' : safeSearch ? 'on' : 'off',
  }
}

export function SearchFilters({
  date, dateRange, region, regionOverride, safeSearch, dates, allowCustomDates, allowRegion,
  defaultRegion, defaultSafeSearch, onApply, searchProvider,
}: SearchFiltersProps) {
  const menu = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  const dateId = useId()
  const fromId = useId()
  const toId = useId()
  const errorId = useId()
  const regionId = useId()
  const safeSearchId = useId()
  const providerId = useId()
  const currentDraft = filterDraft({ date, dateRange, region, regionOverride, safeSearch })
  const [draft, setDraft] = useState(currentDraft)
  const rangeDraft = draft.date === 'custom' ? searchDateRange(draft.from, draft.to) : undefined
  const reversed = draft.date === 'custom' && !!draft.to && draft.from > draft.to
  const nextDate = draft.date === 'custom' ? '' : draft.date
  const active = Boolean(date || dateRange || region || regionOverride || safeSearch !== undefined)
  const changed = date !== nextDate || dateRange?.from !== rangeDraft?.from
    || dateRange?.to !== rangeDraft?.to || currentDraft.region !== draft.region || currentDraft.safeSearch !== draft.safeSearch
  const valid = draft.date !== 'custom' || !!rangeDraft
  const appliedDateLabel = dateRange ? dateLabel.formatRange(new Date(dateRange.from), new Date(dateRange.to))
    : date && dateOptions.find(([id]) => id === date)?.[1]
  const defaultRegionLabel = regions.find(([id]) => id === defaultRegion)?.[1]
  const appliedRegionLabel = regionOverride ? 'Any region' : region && regions.find(([id]) => id === region)?.[1]
  const appliedSafeSearchLabel = safeSearch === undefined ? '' : safeSearch ? 'SafeSearch on' : 'SafeSearch off'
  const appliedLabels = [appliedDateLabel, appliedRegionLabel, appliedSafeSearchLabel].filter(Boolean).join(' · ')

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

  if (!dates.length && !allowCustomDates && !allowRegion && !active && !searchProvider) return null
  return (
    <div className="filter-controls">
      <details className="filter-menu" ref={menu} onKeyDown={event => {
        if (event.key === 'Escape' && event.currentTarget.open) close()
      }}>
        <summary className="filter-trigger" ref={summary} aria-label={active ? 'Filters, ' + appliedLabels : 'Filters'} data-active={active}
          onClick={() => { if (!menu.current?.open) setDraft(currentDraft) }}>
          <ListFilter size={16} aria-hidden="true" />
          <span>{appliedLabels || 'Filters'}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <form className="search-filter-form" onSubmit={event => {
          event.preventDefault()
          if (!valid) return
          close()
          if (changed) onApply({
            date: nextDate, dateRange: rangeDraft, region: draft.region === 'any' ? '' : draft.region,
            regionOverride: draft.region === 'any' ? true : undefined,
            safeSearch: draft.safeSearch === '' ? undefined : draft.safeSearch === 'on',
          })
        }}>
          {searchProvider && <div className="filter-field">
            <label htmlFor={providerId}>Search provider</label>
            <span className="filter-select">
              <select id={providerId} value={searchProvider.selected ?? ''} onChange={event => {
                const value = searchProvider.choices.find(provider => provider === event.target.value)
                close()
                searchProvider.onChange(value)
              }}>
                <option value="">{!searchProvider.selected && searchProvider.used ? 'Default (' + providerNames[searchProvider.used] + ')' : 'Default'}</option>
                {searchProvider.choices.map(provider => <option key={provider} value={provider}>{providerNames[provider]}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>}
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
          {(allowRegion || region || regionOverride) && <div className="filter-field">
            <label htmlFor={regionId}>Region</label>
            <span className="filter-select">
              <select id={regionId} value={draft.region} onChange={event => setDraft({ ...draft, region: event.target.value })}>
                <option value="">{defaultRegion ? `Default (${defaultRegionLabel})` : 'Any region'}</option>
                {(defaultRegion || regionOverride) && <option value="any">Any region</option>}
                {regions.slice(1).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>}
          <div className="filter-field">
            <label htmlFor={safeSearchId}>SafeSearch</label>
            <span className="filter-select">
              <select id={safeSearchId} value={draft.safeSearch} onChange={event => setDraft({ ...draft, safeSearch: event.target.value })}>
                <option value="">Default ({defaultSafeSearch ? 'on' : 'off'})</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="filter-actions">
            <button type="button" className="text-button" onClick={() => setDraft(filterDraft(empty))}
              disabled={!draft.date && !draft.region && !draft.safeSearch}>Reset</button>
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
