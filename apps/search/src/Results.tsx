import { isSearchFaviconHost } from '@pulpo/contracts/search'
import { Ellipsis, Globe2, Image, Pin, Search } from 'lucide-react'
import { useState } from 'react'
import type { SearchResponse } from './api'
import { safeHttpUrl, type SearchLocation } from './navigation'
import type { DomainRule, Preferences } from './preferences'
import { resultEntries, visibleEntries, type ResultWithUrl } from './result-order'

const wordPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu
const commonWords = new Set(['and', 'are', 'for', 'how', 'the', 'this', 'was', 'what', 'where', 'which', 'with'])

function queryTerms(query: string) {
  const withoutOperators = query.replace(/(^|\s)-?[a-z][a-z-]*:(?:"[^"]*"|\S+)/gi, '$1')
  const terms = withoutOperators.normalize('NFC').toLowerCase().match(wordPattern) ?? []
  return new Set(terms.filter(term => term.length > 1 && !commonWords.has(term)))
}

function Highlight({ text, terms }: { text: string; terms: Set<string> }) {
  if (!terms.size) return text
  return text.split(/([\p{L}\p{N}][\p{L}\p{M}\p{N}]*)/gu).map((part, index) => (
    terms.has(part.normalize('NFC').toLowerCase()) ? <mark key={index}>{part}</mark> : part
  ))
}

function formatDate(value: string | undefined) {
  if (!value) return undefined
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ? new Date(value) : undefined
  if (date && !Number.isNaN(date.getTime())) {
    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', ...(dateOnly ? { timeZone: 'UTC' } : {}) })
    return { label: formatter.format(date), iso: dateOnly ? value : date.toISOString() }
  }
  return { label: value, iso: undefined }
}

function pathLabel(url: URL) {
  const segments = url.pathname.split('/').filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment) } catch { return segment }
  })
  return (segments.length > 3 ? [segments[0], '…', segments[segments.length - 1]] : segments).join(' › ')
}

function SiteIcon({ host }: { host: string }) {
  const src = isSearchFaviconHost(host) ? '/api/search/favicon/' + host : undefined
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  return <span className="site-icon" aria-hidden="true">
    {!loaded && <Globe2 size={14} style={{ gridArea: '1 / 1' }} />}
    {src && !failed && <img src={src} alt="" width="16" height="16" loading="lazy" decoding="async" fetchPriority="low"
      referrerPolicy="no-referrer" style={{ opacity: loaded ? 1 : 0, gridArea: '1 / 1' }}
      onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(false) }} />}
  </span>
}

function ImagePreview({ image, url, target }: { image: string | undefined; url: URL; target?: '_blank' }) {
  const [failed, setFailed] = useState(false)
  const src = safeHttpUrl(image)
  return <a className="image-preview" href={url.href} target={target} rel="noreferrer" aria-hidden="true" tabIndex={-1}>
    {src && !failed
      ? <img src={src.href} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <Image size={26} />}
  </a>
}

function ResultItem({ entry, images, newTab, setDomain, showHidden, terms }: {
  entry: ResultWithUrl
  images: boolean
  newTab: boolean
  setDomain: (host: string, rule: DomainRule | undefined) => void
  showHidden: boolean
  terms: Set<string>
}) {
  const { result, url, host, rule } = entry
  const date = formatDate(result.publishedAt)
  const target = newTab ? '_blank' : undefined
  const path = images ? '' : pathLabel(url)
  const title = result.title || host
  return (
    <li className="result">
      {images && <ImagePreview key={result.imageUrl} image={result.imageUrl} url={url} target={target} />}
      <div className="result-meta">
        <SiteIcon host={host} />
        <span className="site-path" title={path ? host + ' › ' + path : host}>{host}
          {path && <span className="result-path"> › {path}</span>}
        </span>
        {rule === 'pin' && <Pin size={13} className="result-pin" aria-label="Pinned site" />}
        <details className="result-menu" onKeyDown={event => {
          if (event.key !== 'Escape' || !event.currentTarget.open) return
          event.preventDefault()
          event.currentTarget.open = false
          event.currentTarget.querySelector('summary')?.focus()
        }} onBlur={event => {
          if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
            event.currentTarget.open = false
          }
        }}>
          <summary className="icon-button" aria-label={`Options for ${host}`}><Ellipsis size={18} /></summary>
          <div className="result-menu-content">
            <button onClick={event => {
              const menu = event.currentTarget.closest('details')
              menu?.removeAttribute('open')
              menu?.querySelector('summary')?.focus()
              setDomain(host, rule === 'pin' ? undefined : 'pin')
            }}>{rule === 'pin' ? 'Unpin site' : 'Pin site'}</button>
            <button onClick={event => {
              const menu = event.currentTarget.closest('details')
              menu?.removeAttribute('open')
              if (showHidden) menu?.querySelector('summary')?.focus()
              else {
                const column = event.currentTarget.closest<HTMLElement>('.results-column')
                const other = [...column?.querySelectorAll<HTMLAnchorElement>('.result-link') ?? []]
                  .find(link => link.hostname.replace(/^www\./, '').replace(/\.$/, '') !== host)
                const nextFocus = other ?? column
                nextFocus?.focus()
              }
              setDomain(host, rule === 'hide' ? undefined : 'hide')
            }}>{rule === 'hide' ? 'Unhide site' : 'Hide site'}</button>
          </div>
        </details>
      </div>
      <h2><a className="result-link" href={url.href} target={target} rel="noreferrer">{title}</a></h2>
      {(result.snippet || date) && (
        <p className="result-snippet">
          {date && (date.iso ? <time className="result-date" dateTime={date.iso}>{date.label}</time> : <span className="result-date">{date.label}</span>)}
          {date && result.snippet && ' · '}
          <Highlight text={result.snippet} terms={terms} />
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
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null)
  const showHidden = expandedQuery === location.query
  const results = resultEntries(data, preferences)
  const hiddenCount = results.filter(item => item.rule === 'hide').length
  const visible = visibleEntries(results, showHidden)
  const answerUrl = safeHttpUrl(data.answer?.url)
  const related = [...new Set(data.related)].filter(query => query !== location.query).slice(0, 8)
  const terms = queryTerms(location.query)

  return (
    <div className="results-body">
      <div className="results-column" tabIndex={-1}>
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
            {visible.map(entry => (
              <ResultItem key={entry.url.href + (entry.result.imageUrl ?? '')} entry={entry} images={location.category === 'images'}
                newTab={preferences.newTab} setDomain={setDomain} showHidden={showHidden} terms={terms} />
            ))}
          </ol>
        ) : !data.answer && (
          <section className="search-message">
            <h2>{hiddenCount ? 'All results are hidden' : 'No results found'}</h2>
            {!hiddenCount && <p>Try fewer words or change your filters.</p>}
          </section>
        )}
        {hiddenCount > 0 && <button className="text-button hidden-toggle" onClick={() => setExpandedQuery(showHidden ? null : location.query)}>
          {showHidden ? 'Hide filtered results' : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'result' : 'results'}`}
        </button>}
      </div>
      {related.length > 0 && (
        <aside className="related" aria-label="Related searches">
          <h2>Related searches</h2>
          <ul>{related.map(query => <li key={query}><button className="secondary-button" onClick={() => onQuery(query)}>
            <Search size={15} className="related-search-icon" aria-hidden="true" /><span>{query}</span>
          </button></li>)}</ul>
        </aside>
      )}
    </div>
  )
}
