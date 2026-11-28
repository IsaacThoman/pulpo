import type { SearchAccountSummary } from '@pulpo/contracts/search'
import { LimitAction } from './AccountParts'
import { providerNames, type SearchApiError, type SearchResponse } from './api'
import type { MoreNotice } from './use-more-results'

export interface MoreResultsControl {
  /** The engine the next batch comes from, and whether it differs from the engine shown so far. */
  next?: { provider: SearchResponse['provider']; switching: boolean }
  loading: boolean
  error?: SearchApiError
  notice?: MoreNotice
  loadedMore: boolean
  load: () => void
  /** Decides where a search limit sends the reader, as it does for the first page. */
  account?: SearchAccountSummary
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
          <p>{control.error.status === 402 ? 'Search limit reached.' : control.error.message}</p>
          {control.error.status === 402
            ? <LimitAction error={control.error} account={control.account} />
            : <button type="button" className="secondary-button" onClick={() => { onLoad?.(); control.load() }}>Try again</button>}
        </div>
      ) : (reveal || next) && (
        // aria-disabled rather than disabled keeps keyboard focus on the button while the batch loads.
        <button type="button" className="secondary-button" aria-busy={control?.loading || undefined} aria-disabled={control?.loading || undefined} onClick={() => {
          if (control?.loading) return
          if (reveal) return reveal()
          onLoad?.()
          control?.load()
        }}>{control?.loading ? 'Loading…' : switching ? `Load more from ${engine}` : 'Load more'}</button>
      )}
      <p className="hint" role="status">{status}</p>
    </div>
  )
}
