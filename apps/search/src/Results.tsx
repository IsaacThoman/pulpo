import { isSearchFaviconHost } from '@pulpo/contracts/search'
import { ChevronDown, Ellipsis, Globe2, Image, Pin, Search } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { SearchResponse } from './api'
import { ImageResultFilters } from './ImageResultFilters'
import { ImageViewer } from './ImageViewer'
import {
  defaultImageRefinements, hasImageFilters, imageSources, imageSourceTime, matchesImageRefinements, orderImageEntries,
  type ImageRefinements,
} from './image-refinements'
import { KnowledgeCard } from './KnowledgeCard'
import { safeHttpUrl, searchPath, type SearchLocation } from './navigation'
import { domainRule, type DomainRule, type Preferences } from './preferences'
import { ResultImage } from './ResultImage'
import { groupResults, resultEntries, visibleEntries, type ResultWithUrl } from './result-order'
import { VideoPreview } from './VideoPreview'
import { videoDurationBucket, videoDurationOptions, type VideoDuration } from './video-duration'

const wordPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu
const commonWords = new Set(['and', 'are', 'for', 'how', 'the', 'this', 'was', 'what', 'where', 'which', 'with'])
const imageBatchSize = 24

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

function ImageThumbnail({ image, thumbnail, title, contain, open }: {
  image: string | undefined
  thumbnail: string | undefined
  title: string
  contain: boolean
  open: (opener: HTMLButtonElement) => void
}) {
  return <button type="button" className="image-preview" aria-label={'Preview image: ' + title} aria-haspopup="dialog"
    data-contain={contain || undefined} onClick={event => open(event.currentTarget)}>
    <ResultImage sources={[thumbnail, image]} alt="" lazy fallback={<Image size={26} aria-hidden="true" />} />
  </button>
}

function ResultItem({ entry, additional, versions, preview, media, video, newTab, setDomain, showHidden, searchSite, terms }: {
  entry: ResultWithUrl
  additional: ResultWithUrl[]
  versions: { url: URL; label: string }[]
  preview?: (opener: HTMLButtonElement) => void
  media: boolean
  video: boolean
  newTab: boolean
  setDomain: (host: string, rule: DomainRule | undefined) => void
  showHidden: boolean
  searchSite?: (host: string) => void
  terms: Set<string>
}) {
  const [versionsOpen, setVersionsOpen] = useState(false)
  const { result, url, host, rule } = entry
  const date = formatDate(result.publishedAt)
  const target = newTab ? '_blank' : undefined
  const path = preview ? '' : pathLabel(url)
  const title = result.title || host
  const thumbnail = media ? safeHttpUrl(result.thumbnailUrl) ?? safeHttpUrl(result.imageUrl) : undefined
  const mediaDetails = media && !video ? [result.creatorName, result.duration].filter(Boolean).join(' · ') : ''
  const videoDuration = video && videoDurationBucket(result.duration) ? result.duration : undefined
  const videoDetails = video ? [result.creatorName, videoDuration].filter(Boolean).join(' · ') : ''
  const reportedDate = date && (date.iso
    ? <time className="result-date" dateTime={date.iso} title="Date reported by the search provider">{date.label}</time>
    : <span className="result-date" title="Date reported by the search provider">{date.label}</span>)
  const dimensions = result.imageDimensions
  const containImage = Boolean(dimensions && (dimensions.width >= 2 * dimensions.height || dimensions.height >= 1.6 * dimensions.width))
  const content = <>
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
      {video && (videoDetails || date) && <p className="video-result-details">
        {videoDetails && <span>{videoDetails}</span>}
        {videoDetails && date && ' · '}
        {reportedDate}
      </p>}
      {(result.snippet || (!video && (date || mediaDetails))) && (
        <p className="result-snippet">
          {mediaDetails && <span className="result-date">{mediaDetails}</span>}
          {mediaDetails && (date || result.snippet) && ' · '}
          {!video && reportedDate}
          {!video && date && result.snippet && ' · '}
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
      {versions.length > 0 && (
        <details className="result-versions" onToggle={event => setVersionsOpen(event.currentTarget.open)}>
          <summary className="text-button"><ChevronDown size={14} aria-hidden="true" />Other versions ({versions.length})</summary>
          {versionsOpen && <ul className="result-sitelinks" aria-label={`Other versions of ${title}`}>
            {versions.map(item => <li key={item.url.href}>
              <a className="result-link" href={item.url.href} target={target} rel="noreferrer" aria-label={`Version ${item.label}`}>{item.label}</a>
            </li>)}
          </ul>}
        </details>
      )}
      {video && <VideoPreview url={url.href} title={title} newTab={newTab} />}
    </>
  return (
    <li className="result" data-video-thumbnail={Boolean(video && thumbnail) || undefined}>
      {preview && <ImageThumbnail key={result.imageUrl + ' ' + result.thumbnailUrl}
        thumbnail={result.thumbnailUrl} image={result.imageUrl} title={title} contain={containImage} open={preview} />}
      {thumbnail && <a className="result-media" href={url.href} target={target} rel="noreferrer" tabIndex={-1} aria-hidden="true">
        <ResultImage key={thumbnail.href} sources={[thumbnail.href, result.imageUrl]} alt="" lazy fallback={<Image size={24} aria-hidden="true" />} />
        {videoDuration && <span className="video-result-runtime">{videoDuration}</span>}
      </a>}
      {video ? <div className="video-result-content">{content}</div> : content}
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
  imageRefinements?: { value: ImageRefinements; update: (value: ImageRefinements) => void }
  imagePagination?: (canAdvance: boolean) => ReactNode
}

export function Results({ data, location, preferences, setDomain, onQuery, onClearScope, imageRefinements, imagePagination }: ResultsProps) {
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ entries: ResultWithUrl[]; startIndex: number; opener: HTMLButtonElement }>()
  const [imageRefinement, setImageRefinement] = useState<{ query: string; value: ImageRefinements }>()
  const [videoDuration, setVideoDuration] = useState<{ scope: string; value: VideoDuration }>()
  const [galleryLimit, setGalleryLimit] = useState(imageBatchSize)
  const gallery = useRef<HTMLOListElement>(null)
  const firstRevealed = useRef<number>(undefined)
  const showHidden = expandedQuery === location.query
  const images = location.category === 'images'
  const videos = location.category === 'videos'
  const media = videos || location.category === 'podcasts'
  const results = resultEntries(data, preferences)
  const hiddenCount = results.filter(item => item.rule === 'hide').length
  const visible = visibleEntries(results, showHidden)
  const videoEntries = videos ? visible.map(entry => ({ entry, duration: videoDurationBucket(entry.result.duration) })) : []
  const withoutDuration = videoEntries.filter(item => !item.duration).length
  const knownDurations = videoEntries.length - withoutDuration
  const canFilterVideoDuration = knownDurations >= 2 && knownDurations > withoutDuration
  const durationScope = videos ? data.provider + searchPath(location) : ''
  const duration = canFilterVideoDuration && videoDuration?.scope === durationScope ? videoDuration.value : 'any'
  const refinements = imageRefinements?.value ?? (imageRefinement?.query === location.query ? imageRefinement.value : defaultImageRefinements)
  const refiningImages = images && hasImageFilters(refinements)
  const matching = refiningImages ? visible.filter(entry => matchesImageRefinements(entry, refinements)) : visible
  const ordered = images ? orderImageEntries(matching, refinements.order) : matching
  const shown = images ? ordered.slice(0, galleryLimit)
    : duration !== 'any' ? videoEntries.filter(item => item.duration === duration).map(item => item.entry) : ordered
  const groups = groupResults(shown, location.category === 'web' ? location.query : undefined)
  const withoutDimensions = images ? visible.filter(entry => !entry.result.imageDimensions).length : 0
  const noMatchingImages = refiningImages && (visible.length > 0 || !hiddenCount) && shown.length === 0
  const noMatchingVideos = duration !== 'any' && shown.length === 0
  const imagesToReveal = Math.min(imageBatchSize, ordered.length - shown.length)
  const answerUrl = safeHttpUrl(data.answer?.url)
  const knowledgeUrl = safeHttpUrl(data.knowledge?.url)
  const knowledge = knowledgeUrl && domainRule(knowledgeUrl.hostname.replace(/\.$/, ''), preferences.domains) !== 'hide'
    ? data.knowledge : undefined
  const related = [...new Set(data.related)].filter(query => query !== location.query).slice(0, 8)
  const terms = queryTerms(location.query)
  const searchSite = location.category === 'web' && location.query.length < 240 && !/\bsite:/i.test(location.query)
    ? (host: string) => onQuery(location.query + ' site:' + host)
    : undefined

  useLayoutEffect(() => {
    const index = firstRevealed.current
    if (index === undefined) return
    firstRevealed.current = undefined
    gallery.current?.children[index]?.querySelector<HTMLButtonElement>('.image-preview')?.focus()
  }, [shown.length])

  function updateImageRefinements(next: ImageRefinements) {
    setGalleryLimit(imageBatchSize)
    if (imageRefinements) imageRefinements.update(next)
    else setImageRefinement({ query: location.query, value: next })
  }

  return (
    <div className={images ? 'results-body image-results-body' : 'results-body'}>
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
        {images && (
          <ImageResultFilters value={refinements} update={updateImageRefinements}
            shown={shown.length} total={visible.length} matches={ordered.length} withoutDimensions={withoutDimensions}
            hasSourceDates={visible.some(entry => imageSourceTime(entry.result.publishedAt) !== undefined)} sources={imageSources(visible)} />
        )}
        {canFilterVideoDuration && <div className="video-duration-filter">
          <label>
            <span>Duration</span>
            <span className="filter-select">
              <select value={duration} onChange={event => {
                const value = videoDurationOptions.find(([option]) => option === event.target.value)?.[0] ?? 'any'
                setVideoDuration({ scope: durationScope, value })
              }}>
                {videoDurationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </label>
          {duration !== 'any' && <p>{shown.length} of {visible.length} videos on this page
            {withoutDuration > 0 && ` · ${withoutDuration} without a reported duration`}
          </p>}
        </div>}
        {shown.length > 0 ? (
          <ol ref={images ? gallery : undefined} className={images ? 'results-list image-grid' : 'results-list'}>
            {groups.map(({ lead: entry, additional, versions }, index) => (
              <ResultItem key={entry.url.href + (entry.result.imageUrl ?? '')} entry={entry}
                additional={additional} versions={versions}
                preview={images ? opener => setPreview({ entries: ordered, startIndex: index, opener }) : undefined}
                media={media} video={videos}
                newTab={preferences.newTab} setDomain={setDomain} showHidden={showHidden} searchSite={searchSite} terms={terms} />
            ))}
          </ol>
        ) : !data.answer && !knowledge && (
          <section className="search-message">
            <h2>{noMatchingImages ? 'No images match these filters' : noMatchingVideos ? 'No videos match this duration' : hiddenCount ? 'All results are hidden' : 'No results found'}</h2>
            {noMatchingImages && <p>{data.hasMore ? 'Clear the image filters or try the next results page.' : 'Clear the image filters to see all images on this page.'}</p>}
            {noMatchingVideos && <p>Try another duration or set it to Any duration.</p>}
            {!noMatchingImages && !noMatchingVideos && !hiddenCount && <p>Try fewer words or change your filters.</p>}
            {!noMatchingImages && !noMatchingVideos && !hiddenCount && onClearScope && <button className="secondary-button" onClick={onClearScope}>Search all sites</button>}
          </section>
        )}
        {images && imagesToReveal > 0 && <div className="image-show-more">
          <button type="button" className="secondary-button" onClick={() => {
            firstRevealed.current = shown.length
            setGalleryLimit(current => current + imageBatchSize)
          }}>Show {imagesToReveal} more {imagesToReveal === 1 ? 'image' : 'images'} on this page</button>
        </div>}
        {hiddenCount > 0 && <button className="text-button hidden-toggle" onClick={() => setExpandedQuery(showHidden ? null : location.query)}>
          {showHidden ? 'Hide filtered results' : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'result' : 'results'}`}
        </button>}
      </div>
      {images && imagePagination?.(imagesToReveal === 0)}
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
