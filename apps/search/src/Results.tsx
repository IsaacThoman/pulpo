import { Ellipsis, Globe2, Image, Pin } from 'lucide-react'
import { useState } from 'react'
import type { SearchResponse, SearchResult } from './api'
import { safeHttpUrl, type SearchLocation } from './navigation'
import { domainRule, type DomainRule, type Preferences } from './preferences'

interface ResultWithUrl {
  result: SearchResult
  url: URL
  host: string
  rule: DomainRule | undefined
}

function formatDate(value: string | undefined) {
  const date = value ? new Date(value) : undefined
  if (date && !Number.isNaN(date.getTime())) {
    return { label: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date), iso: date.toISOString() }
  }
  if (value) return { label: value, iso: undefined }
}

function ResultItem({ entry, images, newTab, setDomain }: {
  entry: ResultWithUrl
  images: boolean
  newTab: boolean
  setDomain: (host: string, rule: DomainRule | undefined) => void
}) {
  const { result, url, host, rule } = entry
  const image = images ? safeHttpUrl(result.imageUrl) : undefined
  const date = formatDate(result.publishedAt)
  const target = newTab ? '_blank' : undefined
  const title = result.title || host
  return (
    <li className="result">
      {images && (
        <a className="image-preview" href={url.href} target={target} rel="noreferrer" aria-hidden="true" tabIndex={-1}>
          {image ? <img src={image.href} alt="" loading="lazy" referrerPolicy="no-referrer"
            onError={event => { event.currentTarget.hidden = true }} /> : <Image size={26} />}
        </a>
      )}
      <div className="result-meta">
        <span className="site-icon"><Globe2 size={13} aria-hidden="true" /></span>
        <span className="site-path" title={host}>{host}
          {url.pathname !== '/' && !images && <span> › {url.pathname.slice(1).replaceAll('/', ' › ')}</span>}
        </span>
        {rule === 'pin' && <Pin size={13} className="result-pin" aria-label="Pinned site" />}
        <details className="result-menu">
          <summary className="icon-button" aria-label={`Options for ${host}`}><Ellipsis size={18} /></summary>
          <div className="result-menu-content">
            <button onClick={event => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              setDomain(host, rule === 'pin' ? undefined : 'pin')
            }}>{rule === 'pin' ? 'Unpin site' : 'Pin site'}</button>
            <button onClick={event => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              setDomain(host, rule === 'hide' ? undefined : 'hide')
            }}>{rule === 'hide' ? 'Unhide site' : 'Hide site'}</button>
          </div>
        </details>
      </div>
      <h2><a className="result-link" href={url.href} target={target} rel="noreferrer">{title}</a></h2>
      {(result.snippet || date) && (
        <p className="result-snippet">
          {date && (date.iso ? <time dateTime={date.iso}>{date.label}</time> : <span className="result-date">{date.label}</span>)}
          {result.snippet}
        </p>
      )}
    </li>
  )
}

interface ResultsProps {
  data: SearchResponse
  location: SearchLocation
  preferences: Preferences
  setDomain: (host: string, rule: DomainRule | undefined) => void
  onQuery: (query: string) => void
}

export function Results({ data, location, preferences, setDomain, onQuery }: ResultsProps) {
  const [showHidden, setShowHidden] = useState(false)
  const results = data.results.flatMap(result => {
    const url = safeHttpUrl(result.url)
    if (!url) return []
    const host = url.hostname.replace(/^www\./, '')
    return [{ result, url, host, rule: domainRule(host, preferences.domains) }]
  })
  const hiddenCount = results.filter(item => item.rule === 'hide').length
  const visible = results.filter(item => showHidden || item.rule !== 'hide')
    .sort((a, b) => Number(b.rule === 'pin') - Number(a.rule === 'pin'))
  const answerUrl = safeHttpUrl(data.answer?.url)
  const related = [...new Set(data.related)].filter(query => query !== location.query).slice(0, 8)

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{visible.length} results for {location.query}</div>
      {data.answer && (
        <aside className="answer" aria-label="Quick answer">
          <h2>{data.answer.title}</h2>
          <p>{data.answer.snippet}</p>
          {answerUrl && <a href={answerUrl.href} rel="noreferrer" target={preferences.newTab ? '_blank' : undefined}>
            {answerUrl.hostname.replace(/^www\./, '')}
          </a>}
        </aside>
      )}
      {visible.length > 0 ? (
        <ol className={location.category === 'images' ? 'results-list image-grid' : 'results-list'}>
          {visible.map((entry, index) => (
            <ResultItem key={entry.url.href + index} entry={entry} images={location.category === 'images'}
              newTab={preferences.newTab} setDomain={setDomain} />
          ))}
        </ol>
      ) : !data.answer && (
        <section className="search-message">
          <h2>{hiddenCount ? 'All results are hidden' : 'No results found'}</h2>
          {!hiddenCount && <p>Try fewer words or change your filters.</p>}
        </section>
      )}
      {hiddenCount > 0 && <button className="text-button hidden-toggle" onClick={() => setShowHidden(value => !value)}>
        {showHidden ? 'Hide filtered results' : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'result' : 'results'}`}
      </button>}
      {related.length > 0 && (
        <section className="related">
          <h2>Related searches</h2>
          <ul>{related.map(query => <li key={query}><button className="secondary-button" onClick={() => onQuery(query)}>{query}</button></li>)}</ul>
        </section>
      )}
    </>
  )
}
