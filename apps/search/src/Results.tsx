import { isSearchFaviconHost } from '@pulpo/contracts/search'
import { Ellipsis, Globe2, Image, Pin, Search } from 'lucide-react'
import { useState } from 'react'
import type { SearchResponse } from './api'
import { ImageResultFilters } from './ImageResultFilters'
import { ImageViewer } from './ImageViewer'
import { defaultImageRefinements, hasImageRefinements, matchesImageRefinements, type ImageRefinements } from './image-refinements'
import { KnowledgeCard } from './KnowledgeCard'
import { safeHttpUrl, type SearchLocation } from './navigation'
import { domainRule, type DomainRule, type Preferences } from './preferences'
import { ResultImage } from './ResultImage'
import { consecutiveSiteResults, resultEntries, visibleEntries, type ResultWithUrl } from './result-order'

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
    // Search timestamps may represent calendar dates stored at midnight UTC.
    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
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

function ImageThumbnail({ image, thumbnail, title, open }: {
  image: string | undefined
  thumbnail: string | undefined
  title: string
  open: (opener: HTMLButtonElement) => void
}) {
  return <button type="button" className="image-preview" aria-label={'Preview image: ' + title} aria-haspopup="dialog"
    onClick={event => open(event.currentTarget)}>
    <ResultImage sources={[thumbnail, image]} alt="" lazy fallback={<Image size={26} aria-hidden="true" />} />
  </button>
}

function ResultItem({ entry, additional, preview, media, newTab, setDomain, showHidden, searchSite, terms }: {
  entry: ResultWithUrl
  additional: ResultWithUrl[]
  preview?: (opener: HTMLButtonElement) => void
  media: boolean
  newTab: boolean
  setDomain: (host: string, rule: DomainRule | undefined) => void
  showHidden: boolean
  searchSite?: (host: string) => void
  terms: Set<string>
}) {
  const { result, url, host, rule } = entry
  const date = formatDate(result.publishedAt)
  const target = newTab ? '_blank' : undefined
  const path = preview ? '' : pathLabel(url)
  const title = result.title || host
  const thumbnail = media ? safeHttpUrl(result.thumbnailUrl) ?? safeHttpUrl(result.imageUrl) : undefined
  const mediaDetails = media ? [result.creatorName, result.duration].filter(Boolean).join(' · ') : ''
  return (
    <li className="result">
      {preview && <ImageThumbnail key={result.imageUrl + ' ' + result.thumbnailUrl}
        thumbnail={result.thumbnailUrl} image={result.imageUrl} title={title} open={preview} />}
      {thumbnail && <a className="result-media" href={url.href} target={target} rel="noreferrer" tabIndex={-1} aria-hidden="true">
        <ResultImage key={thumbnail.href} sources={[thumbnail.href, result.imageUrl]} alt="" lazy fallback={<Image size={24} aria-hidden="true" />} />
      </a>}
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
            {searchSite && isSearchFaviconHost(host) && <button onClick={() => searchSite(host)}>Search this site</button>}
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
      {(result.snippet || date || mediaDetails) && (
        <p className="result-snippet">
          {mediaDetails && <span className="result-date">{mediaDetails}</span>}
          {mediaDetails && (date || result.snippet) && ' · '}
          {date && (date.iso
            ? <time className="result-date" dateTime={date.iso} title="Date reported by the search provider">{date.label}</time>
            : <span className="result-date" title="Date reported by the search provider">{date.label}</span>)}
          {date && result.snippet && ' · '}
          <Highlight text={result.snippet} terms={terms} />
        </p>
      )}
      {additional.length > 0 && (
        <ul className="result-sitelinks" aria-label={'More from ' + host}>
          {additional.map(item => <li key={item.url.href}>
            <a className="result-link" href={item.url.href} target={target} rel="noreferrer">{item.result.title || pathLabel(item.url) || host}</a>
          </li>)}
        </ul>
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
  onClearScope?: () => void
}

export function Results({ data, location, preferences, setDomain, onQuery, onClearScope }: ResultsProps) {
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ entries: ResultWithUrl[]; startIndex: number; opener: HTMLButtonElement }>()
  const [imageRefinement, setImageRefinement] = useState<{ query: string; value: ImageRefinements }>()
  const showHidden = expandedQuery === location.query
  const images = location.category === 'images'
  const media = location.category === 'videos' || location.category === 'podcasts'
  const results = resultEntries(data, preferences)
  const hiddenCount = results.filter(item => item.rule === 'hide').length
  const visible = visibleEntries(results, showHidden)
  const refinements = imageRefinement?.query === location.query ? imageRefinement.value : defaultImageRefinements
  const refiningImages = images && hasImageRefinements(refinements)
  const shown = refiningImages ? visible.filter(entry => matchesImageRefinements(entry.result, refinements)) : visible
  const groups = consecutiveSiteResults(shown, location.category === 'web' && !/\bsite:/i.test(location.query))
  const withoutDimensions = images ? visible.filter(entry => !entry.result.imageDimensions).length : 0
  const noMatchingImages = refiningImages && visible.length > 0 && shown.length === 0
  const answerUrl = safeHttpUrl(data.answer?.url)
  const knowledgeUrl = safeHttpUrl(data.knowledge?.url)
  const knowledge = knowledgeUrl && domainRule(knowledgeUrl.hostname.replace(/\.$/, ''), preferences.domains) !== 'hide'
    ? data.knowledge : undefined
  const related = [...new Set(data.related)].filter(query => query !== location.query).slice(0, 8)
  const terms = queryTerms(location.query)
  const searchSite = location.category === 'web' && location.query.length < 240 && !/\bsite:/i.test(location.query)
    ? (host: string) => onQuery(location.query + ' site:' + host)
    : undefined

  return (
    <div className="results-body">
      {knowledge && knowledgeUrl && <KnowledgeCard knowledge={knowledge} url={knowledgeUrl} newTab={preferences.newTab} />}
      <div className="results-column" tabIndex={-1}>
        <div className="sr-only" role="status" aria-live="polite">{shown.length} results for {location.query}</div>
        {data.answer && (
          <aside className="answer" aria-label="Quick answer">
            <h2>{data.answer.title}</h2>
            <p>{data.answer.snippet}</p>
            {answerUrl && <a href={answerUrl.href} rel="noreferrer" target={preferences.newTab ? '_blank' : undefined}>
              {answerUrl.hostname.replace(/^www\./, '')}
            </a>}
          </aside>
        )}
        {images && (withoutDimensions < visible.length || refiningImages) && (
          <ImageResultFilters value={refinements} update={value => setImageRefinement({ query: location.query, value })}
            shown={shown.length} total={visible.length} withoutDimensions={withoutDimensions} />
        )}
        {shown.length > 0 ? (
          <ol className={images ? 'results-list image-grid' : 'results-list'}>
            {groups.map(({ lead: entry, additional }, index) => (
              <ResultItem key={entry.url.href + (entry.result.imageUrl ?? '')} entry={entry}
                additional={additional}
                preview={images ? opener => setPreview({ entries: shown, startIndex: index, opener }) : undefined}
                media={media}
                newTab={preferences.newTab} setDomain={setDomain} showHidden={showHidden} searchSite={searchSite} terms={terms} />
            ))}
          </ol>
        ) : !data.answer && !knowledge && (
          <section className="search-message">
            <h2>{noMatchingImages ? 'No images match these filters' : hiddenCount ? 'All results are hidden' : 'No results found'}</h2>
            {!noMatchingImages && !hiddenCount && <p>Try fewer words or change your filters.</p>}
            {!noMatchingImages && !hiddenCount && onClearScope && <button className="secondary-button" onClick={onClearScope}>Search all sites</button>}
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
      {images && preview && <ImageViewer {...preview} newTab={preferences.newTab} close={() => setPreview(undefined)} />}
    </div>
  )
}
