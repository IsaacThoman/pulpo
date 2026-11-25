import { formatSearchPrice, providerNames, type SearchApiError, type SearchResponse } from './api'
import { pulpoOrigin } from './auth'
import type { MoreNotice } from './use-more-results'

export interface MoreResultsControl {
  /** The engine the next batch comes from, and whether it differs from the engine shown so far. */
  next?: { provider: SearchResponse['provider']; switching: boolean; priceMicros?: number }
  loading: boolean
  error?: SearchApiError
  notice?: MoreNotice
  loadedMore: boolean
  load: () => void
}

export function LoadMore({ control, reveal, onLoad }: {
  control: MoreResultsControl | undefined
  /** Results already downloaded that can be shown without another search. */
  reveal?: () => void
  onLoad?: () => void
}) {
  const next = control?.next
  if (!reveal && !next && !control?.loading && !control?.error && !(control?.loadedMore || control?.notice)) return null
  const engine = next && next.provider !== 'openverse' ? providerNames[next.provider] : undefined
  const switching = !reveal && next?.switching && engine
  const status = control?.notice === 'none-new' ? 'Those results were already shown.'
    : control?.loadedMore && !next && !reveal ? 'No more results.' : ''
  return (
    <div className="load-more">
      {control?.error ? (
        <div className="load-more-error" role="alert">
          <p>{control.error.status === 402 ? 'Search limit reached. Add credits in Pulpo to load more.' : control.error.message}</p>
          {control.error.status === 402
            ? <a className="secondary-button" href={pulpoOrigin}>Open Pulpo</a>
            : <button type="button" className="secondary-button" onClick={() => { onLoad?.(); control.load() }}>Try again</button>}
        </div>
      ) : (reveal || next) && (
        <button type="button" className="secondary-button" aria-busy={control?.loading || undefined} disabled={control?.loading} onClick={() => {
          if (reveal) return reveal()
          onLoad?.()
          control?.load()
        }}>{control?.loading ? 'Loading…' : switching ? `Load more from ${engine}` : 'Load more'}</button>
      )}
      {switching && !control?.error && <p className="hint">
        {engine} continues these results{next.priceMicros ? ` for ${formatSearchPrice(next.priceMicros)} per search` : ''}.
      </p>}
      <p className="hint" role="status">{status}</p>
    </div>
  )
}
