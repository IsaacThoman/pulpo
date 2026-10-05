import { RefreshCw, X } from 'lucide-react'
import type { AdminRequestsOverview } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FilterSelect, RangePicker, type FilterOption } from '@/features/admin-analytics/components'
import type { AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import {
  CLIENT_PLATFORMS, REQUEST_FILTER_KEYS, REQUEST_ORIGINS, REQUEST_STATUSES,
  categoryLabel, modelName, originLabel, platformLabel, statusLabel,
} from './filters'

export interface IdentityChip { key: 'userId' | 'apiKeyId'; label: string }

function withCurrent(options: FilterOption[], current: string | null, label: (value: string) => string): FilterOption[] {
  if (!current || options.some((option) => option.value === current)) return options
  return [...options, { value: current, label: label(current) }]
}

function modelOptions(overview: AdminRequestsOverview | undefined, current: string | null): FilterOption[] {
  const names = overview?.modelNames ?? {}
  const ids = new Set([...Object.keys(names), ...(overview?.topModels ?? []).map((model) => model.id)])
  const options = [...ids]
    .map((id) => ({ value: id, label: modelName(names, id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return withCurrent(options, current, (id) => modelName(names, id))
}

function categoryOptions(overview: AdminRequestsOverview | undefined, current: string | null): FilterOption[] {
  const options = (overview?.errors.byCategory ?? []).map((item) => ({ value: item.id, label: categoryLabel(item.label || item.id) }))
  return withCurrent(options, current, categoryLabel)
}

export function FilterBar({ search, overview, live, onLiveChange, onRefresh, refreshing, chips }: {
  search: AnalyticsSearch
  overview: AdminRequestsOverview | undefined
  live: boolean
  onLiveChange: (live: boolean) => void
  onRefresh: () => void
  refreshing: boolean
  chips: IdentityChip[]
}) {
  const filtered = REQUEST_FILTER_KEYS.some((key) => search.get(key))
  const clearAll = () => search.update(Object.fromEntries(REQUEST_FILTER_KEYS.map((key) => [key, null])))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker search={search} />
        <FilterSelect search={search} name="status" label={ui('All statuses')} options={REQUEST_STATUSES.map((value) => ({ value, label: statusLabel(value) }))} />
        <FilterSelect search={search} name="origin" label={ui('All sources')} options={REQUEST_ORIGINS.map((value) => ({ value, label: originLabel(value) }))} />
        <FilterSelect search={search} name="platform" label={ui('All platforms')} options={CLIENT_PLATFORMS.map((value) => ({ value, label: platformLabel(value) }))} />
        <FilterSelect search={search} name="model" label={ui('All models')} className="w-44" options={modelOptions(overview, search.get('model'))} />
        <FilterSelect search={search} name="errorCategory" label={ui('All error types')} options={categoryOptions(overview, search.get('errorCategory'))} />
        <FilterSelect search={search} name="agent" label={ui('Agent: any')} options={[{ value: 'true', label: ui('Agent requests') }, { value: 'false', label: ui('Non-agent requests') }]} />
        <FilterSelect search={search} name="retry" label={ui('Retries: any')} options={[{ value: 'true', label: ui('Retried') }, { value: 'false', label: ui('Not retried') }]} />
        <FilterSelect search={search} name="fallback" label={ui('Fallback: any')} options={[{ value: 'true', label: ui('Fell back') }, { value: 'false', label: ui('No fallback') }]} />
        <FilterSelect search={search} name="ocr" label={ui('OCR: any')} options={[{ value: 'true', label: ui('Used OCR') }, { value: 'false', label: ui('No OCR') }]} />
        {filtered && <Button variant="ghost" size="sm" onClick={clearAll}>{ui('Clear filters')}</Button>}
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={live} onCheckedChange={onLiveChange} aria-label={ui('Live updates')} />
          <span className={cn(live && 'text-foreground')}>{ui('Live')}</span>
          {live && <span className="inline-block size-1.5 animate-pulse rounded-full bg-[color:var(--viz-good)]" aria-hidden />}
        </label>
        <Button variant="outline" size="icon-sm" onClick={onRefresh} disabled={refreshing} aria-label={ui('Refresh')} title={ui('Refresh')}>
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
        </Button>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-xs">
              <span className="text-muted-foreground">{chip.key === 'userId' ? ui('User') : ui('API key')}</span>
              <span className="max-w-48 truncate font-medium">{chip.label}</span>
              <Button variant="ghost" size="icon-sm" className="size-5" onClick={() => search.update({ [chip.key]: null })} aria-label={ui('Remove filter')}>
                <X className="size-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
