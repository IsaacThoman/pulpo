import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { AdminSearchOverview, AnalyticsRange } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { FilterSelect, RangePicker } from '@/features/admin-analytics/components'
import { useAnalyticsSearch, type AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui } from '@/i18n/ui'
import { apiRequest } from '@/lib/api'
import { RecentSearches } from './search/RecentSearches'
import { OutcomeList, PhaseBreakdown, ProviderLatencyTable, SearchKpiRow, SearchLatencyChart } from './search/SearchPanels'
import { SEARCH_CATEGORIES, SEARCH_FILTER_KEYS, SEARCH_OUTCOMES, SEARCH_PROVIDERS, categoryLabel, outcomeLabel, providerLabel } from './search/labels'

/** Search timing is kept for 30 days, so longer ranges would only repeat these. */
const SEARCH_RANGES: AnalyticsRange[] = ['1h', '24h', '7d', '30d', 'custom']
const searchKey = (query: string) => ['admin-analytics', 'search', query] as const

function SearchFilters({ search }: { search: AnalyticsSearch }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RangePicker search={search} ranges={SEARCH_RANGES} />
      <FilterSelect search={search} name="kind" label={ui('Web and places')} options={[{ value: 'query', label: ui('Web search') }, { value: 'places', label: ui('Places') }]} />
      <FilterSelect search={search} name="provider" label={ui('All providers')} options={SEARCH_PROVIDERS.map((value) => ({ value, label: providerLabel(value) }))} />
      <FilterSelect search={search} name="category" label={ui('All types')} options={SEARCH_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))} />
      <FilterSelect search={search} name="outcome" label={ui('All outcomes')} options={SEARCH_OUTCOMES.map((value) => ({ value, label: outcomeLabel(value) }))} />
    </div>
  )
}

/** Where Pulpo Search spends its time: provider calls, fallbacks and server overhead. */
export function AdminSearchPage() {
  const search = useAnalyticsSearch('24h')
  const queryClient = useQueryClient()
  const query = search.query(SEARCH_FILTER_KEYS)
  const overview = useQuery({
    queryKey: searchKey(query),
    queryFn: ({ signal }) => apiRequest<AdminSearchOverview>(`/api/admin/analytics/search?${query}`, { signal }),
    placeholderData: (previous) => previous,
  })
  const data = overview.data
  const loading = overview.isPending
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{ui('Search')}</h2>
          <p className="text-xs text-muted-foreground">{ui('How long Pulpo Search takes and where the time goes: providers, fallbacks and server overhead. Kept for 30 days.')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: searchKey(query) })} disabled={overview.isFetching}>
          <RefreshCw className={overview.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
          {ui('Refresh')}
        </Button>
      </div>
      <SearchFilters search={search} />
      {overview.isError && !data ? (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-destructive">
          <span>{overview.error instanceof Error && overview.error.message ? overview.error.message : ui("Couldn't load Search timing")}</span>
          <Button variant="outline" size="sm" onClick={() => void overview.refetch()}>{ui('Retry')}</Button>
        </div>
      ) : (
        <>
          <SearchKpiRow current={data?.kpis.current} previous={data?.kpis.previous} loading={loading} />
          <div className="grid gap-3 lg:grid-cols-3">
            <SearchLatencyChart data={data} loading={loading} />
            <PhaseBreakdown data={data} loading={loading} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2"><ProviderLatencyTable data={data} loading={loading} /></div>
            <OutcomeList data={data} loading={loading} />
          </div>
          <RecentSearches rows={data?.recent ?? []} loading={loading} />
        </>
      )}
    </div>
  )
}
