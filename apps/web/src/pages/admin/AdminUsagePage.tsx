import { useQueryClient } from '@tanstack/react-query'
import type { AdminRequestRow, AdminRequestsOverview, AdminRequestSort } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { useAnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui } from '@/i18n/ui'
import { ErrorsPanel } from './requests/ErrorsPanel'
import { FilterBar, type IdentityChip } from './requests/FilterBar'
import { KpiRow } from './requests/KpiRow'
import { LatencyChart, RequestsOverTimeChart, SpendOverTimeChart } from './requests/OverviewCharts'
import { ReliabilityPanel } from './requests/ReliabilityPanel'
import { RequestTable } from './requests/RequestTable'
import { TopLists } from './requests/TopLists'
import { REQUEST_FILTER_KEYS, parseSort } from './requests/filters'
import { requestsKeys, useRequestsList, useRequestsOverview } from './requests/queries'
import { useLiveRequests } from './requests/use-live-requests'

function identityChips(
  userId: string | null,
  apiKeyId: string | null,
  overview: AdminRequestsOverview | undefined,
  rows: AdminRequestRow[],
): IdentityChip[] {
  const chips: IdentityChip[] = []
  if (userId) {
    const label = overview?.topUsers.find((user) => user.id === userId)?.label
      ?? rows.find((row) => row.user?.id === userId)?.user?.name
    chips.push({ key: 'userId', label: label ?? userId.slice(0, 8) })
  }
  if (apiKeyId) {
    const label = overview?.topApiKeys.find((key) => key.id === apiKeyId)?.label
      ?? rows.find((row) => row.apiKey?.id === apiKeyId)?.apiKey?.name
    chips.push({ key: 'apiKeyId', label: label ?? apiKeyId.slice(0, 8) })
  }
  return chips
}

/** Operations dashboard for model requests: what's failing, what's slow, what it costs. */
export function AdminUsagePage() {
  const search = useAnalyticsSearch('24h')
  const queryClient = useQueryClient()
  const query = search.query(REQUEST_FILTER_KEYS)
  const sort = parseSort(search.get('sort'))
  const live = search.get('live') === '1'

  const overview = useRequestsOverview(query)
  const list = useRequestsList(query, sort)
  useLiveRequests({ enabled: live, query, sort })

  const data = overview.data
  const rows = list.data?.pages.flatMap((page) => page.data) ?? []
  const overviewLoading = overview.isPending
  const filterBy = (key: string, value: string) => search.update({ [key]: value })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: requestsKeys.overview(query) })
    void queryClient.invalidateQueries({ queryKey: requestsKeys.list(query, sort) })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{ui('Requests')}</h2>
        <p className="text-xs text-muted-foreground">{ui('What’s failing, what’s slow, and what it costs across every web, API, and agent model call.')}</p>
      </div>
      <FilterBar
        search={search}
        overview={data}
        live={live}
        onLiveChange={(next) => search.update({ live: next ? '1' : null })}
        onRefresh={refresh}
        refreshing={overview.isFetching || (list.isFetching && !list.isFetchingNextPage)}
        chips={identityChips(search.get('userId'), search.get('apiKeyId'), data, rows)}
      />
      {overview.isError && (
        <div role="alert" className="flex items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          <span className="min-w-0 flex-1">{overview.error.message}</span>
          <Button variant="outline" size="sm" onClick={() => void overview.refetch()}>{ui('Retry')}</Button>
        </div>
      )}
      <KpiRow current={data?.kpis.current} previous={data?.kpis.previous} loading={overviewLoading} />
      <div className="grid gap-3 lg:grid-cols-2">
        <RequestsOverTimeChart overview={data} loading={overviewLoading} />
        <LatencyChart overview={data} loading={overviewLoading} />
      </div>
      <SpendOverTimeChart overview={data} loading={overviewLoading} />
      <ErrorsPanel
        overview={data}
        loading={overviewLoading}
        onCategory={(category) => filterBy('errorCategory', category)}
        onModel={(modelId) => filterBy('model', modelId)}
      />
      <ReliabilityPanel overview={data} loading={overviewLoading} onModel={(modelId) => filterBy('model', modelId)} />
      <TopLists
        overview={data}
        loading={overviewLoading}
        filters={{ model: search.get('model'), userId: search.get('userId'), apiKeyId: search.get('apiKeyId') }}
        onFilter={filterBy}
      />
      <RequestTable
        rows={rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        sort={sort}
        onSort={(next: AdminRequestSort) => search.update({ sort: next === 'newest' ? null : next })}
        modelNames={data?.modelNames ?? {}}
        onFilter={filterBy}
      />
    </div>
  )
}
