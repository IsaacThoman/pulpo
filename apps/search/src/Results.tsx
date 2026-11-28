import { isSearchFaviconHost } from '@pulpo/contracts/search'
import { ChevronDown, CircleHelp, Ellipsis, Globe2, Image, Pin } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SearchResponse, SearchResult } from './api'
import { faviconBackdrop, sampleFavicon } from './favicon-contrast'
import { ImageResultFilters } from './ImageResultFilters'
import { galleryGap, sizeImageTiles, type ImageTileSize } from './image-layout'
import { ImageViewer } from './ImageViewer'
import {
  defaultImageRefinements, hasImageFilters, imageSources, imageSourceTime, matchesImageRefinements, orderImageEntries,
  type ImageRefinements,
} from './image-refinements'
import { KnowledgeCard } from './KnowledgeCard'
import { LoadMore, type MoreResultsControl } from './LoadMore'
import { recentNewsQuery, safeHttpUrl, searchPath, type SearchLocation } from './navigation'
import { domainRule, type DomainRule, type Preferences } from './preferences'
import { ResultImage } from './ResultImage'
import { groupResults, resultEntries, visibleEntries, type ResultWithUrl } from './result-order'
import { formatResultStats, type ResultStats } from './result-stats'
import { licenseLabel } from './reusable-images'
import { imageBatchSize } from './use-more-results'
import { VideoPreview } from './VideoPreview'
import { videoDurationBucket, videoDurationOptions, type VideoDuration } from './video-duration'

const wordPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu
const commonWords = new Set(['and', 'are', 'for', 'how', 'the', 'this', 'was', 'what', 'where', 'which', 'with'])
const newsAgeInSeconds = { minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }
const compactCount = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

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

function formatDate(value: string | undefined, newsNow: number | undefined) {
  if (!value) return undefined
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ? new Date(value) : undefined
  if (date && !Number.isNaN(date.getTime())) {
    // Search timestamps may represent calendar dates stored at midnight UTC.
    const iso = dateOnly ? value : date.toISOString()
    const calendarDate = dateOnly || /T00:00:00(?:\.0+)?Z$/.test(value)
    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: calendarDate ? 'UTC' : undefined })
    const absolute = formatter.format(date)
    const age = newsNow === undefined || calendarDate ? undefined : (newsNow - date.getTime()) / 1000
    if (age !== undefined && age >= 0 && age < newsAgeInSeconds.week) {
      const unit = age < newsAgeInSeconds.hour ? 'minute' : age < newsAgeInSeconds.day ? 'hour' : 'day'
      const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
      return { label: relative.format(-Math.floor(age / newsAgeInSeconds[unit]), unit), iso, absolute }
    }
    return { label: absolute, iso }
  }
  return { label: value, iso: undefined }
}

function newsSourceTime(value: string | undefined, now: number) {
  const timestamp = imageSourceTime(value)
  if (timestamp !== undefined) return timestamp
  // Firecrawl also supplies rounded ages. Use those for ordering and retain the original label.
  const age = value?.match(/^(\d{1,4}) (minute|hour|day|week|month|year)s? ago$/i)
  if (!age) return
  const unit = age[2].toLowerCase() as keyof typeof newsAgeInSeconds
  return now - Number(age[1]) * newsAgeInSeconds[unit] * 1000
}

function pathLabel(url: URL) {
  const segments = url.pathname.split('/').filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment) } catch { return segment }
  })
  return (segments.length > 3 ? [segments[0], '…', segments[segments.length - 1]] : segments).join(' › ')
}

function SiteIcon({ host, pageColor }: { host: string; pageColor: string | undefined }) {
  const src = isSearchFaviconHost(host) ? '/api/search/favicon/' + host : undefined
  const [favicon, setFavicon] = useState<Uint8ClampedArray | 'loaded' | 'failed'>()
  const loaded = favicon !== undefined && favicon !== 'failed'
  const backgroundColor = useMemo(() => (
    pageColor && favicon instanceof Uint8ClampedArray ? faviconBackdrop(favicon, pageColor) : undefined
  ), [favicon, pageColor])
  return <span className="site-icon" aria-hidden="true" style={{ backgroundColor }}>
    {!loaded && <Globe2 size={14} style={{ gridArea: '1 / 1' }} />}
    {src && favicon !== 'failed' && <img src={src} alt="" width="16" height="16" loading="lazy" decoding="async" fetchPriority="low"
      referrerPolicy="no-referrer" style={{ opacity: loaded ? 1 : 0, gridArea: '1 / 1' }}
      onLoad={event => setFavicon(sampleFavicon(event.currentTarget) ?? 'loaded')} onError={() => setFavicon('failed')} />}
  </span>
}

function ImageThumbnail({ image, thumbnail, title, source, license, dimensions, contain, open, tileHeight }: {
  image: string | undefined
  thumbnail: string | undefined
  title: string
  source: string
  license?: string
  dimensions?: { width: number; height: number }
  contain: boolean
  tileHeight?: number
  open: (opener: HTMLButtonElement) => void
}) {
  return <button type="button" className="image-preview" aria-label={'Preview image: ' + title} aria-haspopup="dialog"
    aria-description={[source, dimensions && `${dimensions.width} × ${dimensions.height}`, license && 'Reported license: ' + license].filter(Boolean).join(' · ')}
    data-contain={contain || undefined} style={tileHeight ? { height: tileHeight } : undefined} onClick={event => open(event.currentTarget)}>
    <ResultImage sources={[thumbnail, image]} alt="" lazy fallback={<Image size={26} aria-hidden="true" />} />
    <span className="image-source-label" aria-hidden="true">{source}</span>
    {dimensions && <span className="image-dimensions-badge" aria-hidden="true">{dimensions.width} × {dimensions.height}</span>}
    {license && <span className="image-license-badge">{license}</span>}
  </button>
}

function ResultItem({ entry, additional, versions, preview, imageTile, media, video, newsNow, newTab, setDomain, showHidden, searchSite, terms, pageColor }: {
  entry: ResultWithUrl
  additional: ResultWithUrl[]
  versions: { url: URL; label: string }[]
  preview?: (opener: HTMLButtonElement) => void
  imageTile?: ImageTileSize
  media: boolean
  video: boolean
  newsNow?: number
  newTab: boolean
  setDomain: (host: string, rule: DomainRule | undefined) => void
  showHidden: boolean
  searchSite?: (host: string) => void
  terms: Set<string>
  pageColor?: string
}) {
  const [versionsOpen, setVersionsOpen] = useState(false)
  const { result, url, host, rule } = entry
  const news = newsNow !== undefined
  const date = formatDate(result.publishedAt, newsNow)
  const target = newTab ? '_blank' : undefined
  const path = preview || news || media ? '' : pathLabel(url)
  const title = result.title || host
  const thumbnail = media || news ? safeHttpUrl(result.thumbnailUrl) ?? safeHttpUrl(result.imageUrl) : undefined
  const mediaDetails = media && !video ? [result.creatorName, result.duration].filter(Boolean).join(' · ') : ''
  const videoDuration = video && videoDurationBucket(result.duration) ? result.duration : undefined
  const views = result.viewCount === undefined ? undefined : compactCount.format(result.viewCount) + (result.viewCount === 1 ? ' view' : ' views')
  const videoDetails = video ? [result.creatorName, !thumbnail && videoDuration, views].filter(Boolean).join(' · ') : ''
  const reportedDate = date && (date.iso
    ? <time className="result-date" dateTime={date.iso} title={date.absolute ?? 'Date reported by the search provider'}>{date.label}</time>
    : <span className="result-date" title="Date reported by the search provider">{date.label}</span>)
  const dimensions = result.imageDimensions
  const containImage = Boolean(dimensions && (dimensions.width >= 2 * dimensions.height || dimensions.height >= 1.6 * dimensions.width))
  const mediaImage = thumbnail && <div className="result-media">
    <a className="result-media-link" href={url.href} target={target} rel="noreferrer" tabIndex={-1} aria-hidden="true">
      <ResultImage key={thumbnail.href} sources={[thumbnail.href, result.imageUrl]} alt="" lazy fallback={<Image size={24} aria-hidden="true" />} />
      {videoDuration && <span className="video-result-runtime">{videoDuration}</span>}
    </a>
    {video && <VideoPreview url={url.href} title={title} newTab={newTab} overThumbnail />}
  </div>
  const heading = <h2><a className="result-link" href={url.href} target={target} rel="noreferrer" title={preview ? title : undefined}>{title}</a></h2>
  const metadata = <div className="result-meta">
        {!preview && <SiteIcon host={host} pageColor={pageColor} />}
        <span className="site-path" title={path ? host + ' › ' + path : host}>{host}
          {path && <span className="result-path"> › {path}</span>}
        </span>
        {news && date && <span className="news-result-date"> · {reportedDate}</span>}
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
            {preview && dimensions && <p className="image-menu-dimensions">{dimensions.width} × {dimensions.height} px</p>}
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
  const content = <>
      {preview ? <div className="image-caption">{heading}{metadata}</div> : <>{metadata}{heading}</>}
      {video && (videoDetails || date || videoDuration) && <p className="video-result-details">
        {thumbnail && videoDuration && <span className="sr-only">Duration {videoDuration}. </span>}
        {videoDetails && <span>{videoDetails}</span>}
        {videoDetails && date && ' · '}
        {reportedDate}
      </p>}
      {!preview && (result.snippet || (!video && !news && (date || mediaDetails))) && (
        <p className="result-snippet">
          {mediaDetails && <span className="result-date">{mediaDetails}</span>}
          {mediaDetails && (date || result.snippet) && ' · '}
          {!video && !news && reportedDate}
          {!video && !news && date && result.snippet && ' · '}
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
      {video && !thumbnail && <VideoPreview url={url.href} title={title} newTab={newTab} />}
    </>
  return (
    <li className="result" data-video-thumbnail={Boolean(video && thumbnail) || undefined} data-news-thumbnail={Boolean(news && thumbnail) || undefined}
      data-row-start={imageTile?.rowStart || undefined} style={imageTile ? { width: imageTile.width } : undefined}>
      {preview && <ImageThumbnail key={result.imageUrl + ' ' + result.thumbnailUrl}
        thumbnail={result.thumbnailUrl} image={result.imageUrl} title={title} source={host} contain={containImage} open={preview}
        dimensions={dimensions}
        tileHeight={imageTile?.height}
        license={result.imageLicense && licenseLabel(result.imageLicense.code, result.imageLicense.version)} />}
      {!news && mediaImage}
      {video || (news && thumbnail) ? <div className="media-result-content">{content}</div> : content}
      {news && mediaImage}
    </li>
  )
}

interface ResultsProps {
  data: SearchResponse
  location: SearchLocation
  preferences: Preferences
  pageColor?: string
  setDomain: (host: string, rule: DomainRule | undefined) => void
  onQuery: (query: string) => void
  onClearScope?: () => void
  imageRefinements?: { value: ImageRefinements; update: (value: ImageRefinements) => void }
  imageToolbar?: HTMLElement | null
  mediaToolbar?: HTMLElement | null
  /** The batch each result arrived in. Ordering and grouping stay within a batch so loaded results land at the end. */
  batchOf?: ReadonlyMap<SearchResult, number>
  more?: MoreResultsControl
  gallery?: { limit: number; setLimit: (value: number | ((current: number) => number)) => void }
  /** How many results came back and how long they took, shown above result lists. */
  stats?: ResultStats
  /** Reports how many results are shown, for the page's announcement. */
  onShown?: (count: number) => void
}

function withinBatches<T extends { result: SearchResult }, U>(entries: T[], batchOf: ResultsProps['batchOf'], arrange: (entries: T[]) => U[]): U[] {
  if (!batchOf?.size) return arrange(entries)
  const batches = new Map<number, T[]>()
  for (const entry of entries) {
    const batch = batchOf.get(entry.result) ?? 0
    batches.set(batch, [...batches.get(batch) ?? [], entry])
  }
  return [...batches].sort(([left], [right]) => left - right).flatMap(([, items]) => arrange(items))
}

export function Results({ data, location, preferences, pageColor, setDomain, onQuery, onClearScope, imageRefinements, imageToolbar, mediaToolbar, batchOf, more, gallery, stats, onShown }: ResultsProps) {
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ entries: ResultWithUrl[]; startIndex: number; opener: HTMLButtonElement }>()
  const [imageRefinement, setImageRefinement] = useState<{ query: string; value: ImageRefinements }>()
  const [videoDuration, setVideoDuration] = useState<{ scope: string; value: VideoDuration }>()
  const [newsOrder, setNewsOrder] = useState<'relevance' | 'newest'>()
  const [localGalleryLimit, setLocalGalleryLimit] = useState(imageBatchSize)
  const galleryLimit = gallery?.limit ?? localGalleryLimit
  const setGalleryLimit = gallery?.setLimit ?? setLocalGalleryLimit
  const [galleryWidth, setGalleryWidth] = useState(0)
  const list = useRef<HTMLOListElement>(null)
  const firstRevealed = useRef<number>(undefined)
  const showHidden = expandedQuery === location.query
  const images = location.category === 'images'
  const videos = location.category === 'videos'
  const news = location.category === 'news'
  const media = videos || location.category === 'podcasts'
  const results = resultEntries(data, preferences)
  const podcastShows = location.category === 'podcasts' && data.podcastShows
    ? visibleEntries(resultEntries({ ...data, results: data.podcastShows }, preferences), false) : []
  const hiddenCount = results.filter(item => item.rule === 'hide').length
  const visible = withinBatches(results, batchOf, entries => visibleEntries(entries, showHidden))
  const now = Date.now()
  const newsEntries = news ? visible.map(entry => ({ entry, time: newsSourceTime(entry.result.publishedAt, now) })) : []
  const canSortNews = newsEntries.filter(item => item.time !== undefined).length >= 2
  const wantsRecentNews = recentNewsQuery(location.query) || location.date === 'day' || location.date === 'week'
  const newestNews = newsOrder === undefined ? wantsRecentNews : newsOrder === 'newest'
  const videoEntries = videos ? visible.map(entry => ({ entry, duration: videoDurationBucket(entry.result.duration) })) : []
  const withoutDuration = videoEntries.filter(item => !item.duration).length
  const knownDurations = videoEntries.length - withoutDuration
  const canFilterVideoDuration = knownDurations >= 2 && knownDurations > withoutDuration
  const durationScope = videos ? data.provider + searchPath(location) : ''
  const duration = canFilterVideoDuration && videoDuration?.scope === durationScope ? videoDuration.value : 'any'
  const refinements = imageRefinements?.value ?? (imageRefinement?.query === location.query ? imageRefinement.value : defaultImageRefinements)
  const refiningImages = images && hasImageFilters(refinements)
  const matching = refiningImages ? visible.filter(entry => matchesImageRefinements(entry, refinements)) : visible
  const ordered = images ? withinBatches(matching, batchOf, entries => orderImageEntries(entries, refinements.order))
    : newestNews && canSortNews ? withinBatches(newsEntries.map(item => ({ ...item, result: item.entry.result })), batchOf, entries => entries
      .sort((left, right) => Number(right.entry.rule === 'pin') - Number(left.entry.rule === 'pin')
        || (right.time === left.time ? 0 : (right.time ?? -Infinity) - (left.time ?? -Infinity)))).map(item => item.entry)
    : matching
  const shown = images ? ordered.slice(0, galleryLimit)
    : duration !== 'any' ? videoEntries.filter(item => item.duration === duration).map(item => item.entry) : ordered
  const videoGrid = videos && shown.length >= 2 && shown.filter(({ result }) => result.thumbnailUrl || result.imageUrl).length > shown.length / 2
  const groups = withinBatches(shown, batchOf, entries => groupResults(entries, location.category === 'web' ? location.query : undefined))
  const hasGallery = images && shown.length > 0
  const imageTiles = hasGallery && galleryWidth > 0 ? sizeImageTiles(groups.map(({ lead }) => {
    const dimensions = lead.result.imageDimensions
    return dimensions ? dimensions.width / dimensions.height : undefined
  }), galleryWidth) : []
  const withoutDimensions = images ? visible.filter(entry => !entry.result.imageDimensions).length : 0
  const noMatchingImages = refiningImages && (visible.length > 0 || !hiddenCount) && shown.length === 0
  const noMatchingVideos = duration !== 'any' && shown.length === 0
  const imagesToReveal = Math.min(imageBatchSize, ordered.length - shown.length)
  const answerUrl = safeHttpUrl(data.answer?.url)
  const knowledgeUrl = safeHttpUrl(data.knowledge?.url)
  const knowledge = knowledgeUrl && domainRule(knowledgeUrl.hostname.replace(/\.$/, ''), preferences.domains) !== 'hide'
    ? data.knowledge : undefined
  const knowledgeArticle = knowledge && data.provider === 'kagi'
    ? data.results.find(result => safeHttpUrl(result.url)?.href === knowledgeUrl?.href) : undefined
  const knowledgeImage = safeHttpUrl(knowledgeArticle?.thumbnailUrl ?? knowledgeArticle?.imageUrl)
  const terms = queryTerms(location.query)
  const searchSite = location.category === 'web' && location.query.length < 240 && !/\bsite:/i.test(location.query)
    ? (host: string) => onQuery(location.query + ' site:' + host)
    : undefined

  useEffect(() => { onShown?.(shown.length) }, [onShown, shown.length])

  useLayoutEffect(() => {
    const index = firstRevealed.current
    if (index === undefined) return
    firstRevealed.current = undefined
    list.current?.children[index]?.querySelector<HTMLElement>('.image-preview, .result-link')?.focus()
  }, [groups.length])

  useLayoutEffect(() => {
    const element = list.current
    if (!element || !hasGallery) return
    const resize = () => setGalleryWidth(element.clientWidth)
    resize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasGallery])

  function revealImages() {
    firstRevealed.current = shown.length
    setGalleryLimit(current => current + imageBatchSize)
  }

  function updateImageRefinements(next: ImageRefinements) {
    setGalleryLimit(imageBatchSize)
    if (imageRefinements) imageRefinements.update(next)
    else setImageRefinement({ query: location.query, value: next })
  }
  const galleryFilters = images && <ImageResultFilters value={refinements} update={updateImageRefinements}
    shown={shown.length} total={visible.length} matches={ordered.length} withoutDimensions={withoutDimensions}
    hasSourceDates={visible.some(entry => imageSourceTime(entry.result.publishedAt) !== undefined)} sources={imageSources(visible)} />
  const mediaFilters = <>
    {canSortNews && <span className="scope-select">
      <span className="scope-select-value" aria-hidden="true">{newestNews ? 'Newest' : 'Relevance'}</span>
      <select aria-label="Sort news" value={newestNews ? 'newest' : 'relevance'}
        onChange={event => setNewsOrder(event.target.value === 'newest' ? 'newest' : 'relevance')}>
        <option value="relevance">Relevance</option>
        <option value="newest">Newest</option>
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </span>}
    {news && (location.date || location.dateRange) && <details className="news-date-info">
      <summary className="icon-button" aria-label="About news dates" title="About news dates"><CircleHelp size={16} aria-hidden="true" /></summary>
      <p>The date filter includes articles updated during this period.</p>
    </details>}
    {canFilterVideoDuration && <span className="scope-select">
      <span className="scope-select-value" aria-hidden="true">{videoDurationOptions.find(([value]) => value === duration)?.[1]}</span>
      <select aria-label="Duration" value={duration} onChange={event => {
        const value = videoDurationOptions.find(([option]) => option === event.target.value)?.[0] ?? 'any'
        setVideoDuration({ scope: durationScope, value })
      }}>
        {videoDurationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </span>}
  </>

  return (
    <div className={'results-body' + (images ? ' image-results-body' : videoGrid ? ' video-results-body' : '')}>
      {knowledge && knowledgeUrl && <KnowledgeCard knowledge={knowledge} url={knowledgeUrl} newTab={preferences.newTab}
        thumbnail={knowledgeImage?.origin === 'https://p.kagi.com' ? knowledgeImage.href : undefined} />}
      <div className="results-column" tabIndex={-1}>
        {stats && !images && shown.length > 0 && duration === 'any' && <p className="result-stats">{formatResultStats(shown.length, stats)}</p>}
        {data.answer && (
          <aside className="answer" aria-label="Direct answer">
            <h2>{data.answer.title}</h2>
            <p>{data.answer.snippet}</p>
            {answerUrl && <a href={answerUrl.href} rel="noreferrer" target={preferences.newTab ? '_blank' : undefined}>
              {answerUrl.hostname.replace(/^www\./, '')}
            </a>}
          </aside>
        )}
        {galleryFilters && (imageToolbar ? createPortal(galleryFilters, imageToolbar) : galleryFilters)}
        {(canSortNews || (news && (location.date || location.dateRange)) || canFilterVideoDuration) && (mediaToolbar
          ? createPortal(mediaFilters, mediaToolbar) : <div className="media-toolbar-slot standalone-media-filters">{mediaFilters}</div>)}
        {duration !== 'any' && <p className="filtered-video-count">{shown.length} of {visible.length} videos
          {withoutDuration > 0 && ` · ${withoutDuration} without a reported duration`}
        </p>}
        {podcastShows.length > 0 && <section className="podcast-shows" aria-label="Podcast shows">
          <h2>Shows</h2>
          <ul>{podcastShows.map(({ result, url }) => <li key={url.href}>
            <a href={url.href} rel="noreferrer" target={preferences.newTab ? '_blank' : undefined}>
              {result.imageUrl && <ResultImage sources={[result.imageUrl]} alt="" lazy fallback={null} />}
              <span>{result.title}</span>
            </a>
          </li>)}</ul>
        </section>}
        {shown.length > 0 ? (
          <>
          {podcastShows.length > 0 && <h2 className="episode-heading">Episodes</h2>}
          <ol ref={list} className={images ? 'results-list image-grid' : videoGrid ? 'results-list video-results-grid' : 'results-list'}
            data-justified={imageTiles.length > 0 || undefined} style={imageTiles.length > 0 ? { gap: galleryGap } : undefined}>
            {groups.map(({ lead: entry, additional, versions }, index) => (
              <ResultItem key={entry.url.href + (entry.result.imageUrl ?? '')} entry={entry}
                additional={additional} versions={versions}
                preview={images ? opener => setPreview({ entries: ordered, startIndex: index, opener }) : undefined}
                imageTile={imageTiles[index]}
                media={media} video={videos} newsNow={news ? now : undefined}
                newTab={preferences.newTab} setDomain={setDomain} showHidden={showHidden} searchSite={searchSite} terms={terms} pageColor={pageColor} />
            ))}
          </ol>
          </>
        ) : !data.answer && !knowledge && !podcastShows.length && (
          <section className="search-message">
            <h2>{noMatchingImages ? 'No images match these filters' : noMatchingVideos ? 'No videos match this duration' : hiddenCount ? 'All results are hidden' : 'No results found'}</h2>
            {noMatchingImages && <p>{more?.next ? 'Clear the image filters or load more images.' : 'Clear the image filters to see every image.'}</p>}
            {noMatchingVideos && <p>Try another duration or set it to Any duration.</p>}
            {!noMatchingImages && !noMatchingVideos && !hiddenCount && <p>Try fewer words or change your filters.</p>}
            {!noMatchingImages && !noMatchingVideos && !hiddenCount && onClearScope && <button className="secondary-button" onClick={onClearScope}>Search all sites</button>}
          </section>
        )}
        {hiddenCount > 0 && <button className="text-button hidden-toggle" onClick={() => setExpandedQuery(showHidden ? null : location.query)}>
          {showHidden ? 'Hide filtered results' : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'result' : 'results'}`}
        </button>}
        <LoadMore control={more} reveal={imagesToReveal > 0 ? revealImages : undefined}
          onLoad={images ? revealImages : () => { firstRevealed.current = groups.length }} />
      </div>
      {images && preview && <ImageViewer {...preview} newTab={preferences.newTab} close={() => setPreview(undefined)} />}
    </div>
  )
}
