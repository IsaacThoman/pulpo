import { ChevronDown, ExternalLink, Globe2, Image, Keyboard, MapPin, Newspaper, Podcast, Settings2, Sparkles, Video } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, providerNames, SearchApiError, type SearchConfig, type SearchUser } from './api'
import { useSearchAppearance } from './appearance'
import { buildAskPulpoUrl } from './ask-pulpo'
import { consumeCallback, pulpoOrigin, startSignIn } from './auth'
import { firstResultQuery, resolveBang, type CustomBang } from './bangs'
import { Calculator } from './Calculator'
import { CurrencyAnswer } from './CurrencyAnswer'
import { parseCurrencyQuery } from './currency'
import { instantAnswer } from './instant-answer'
import { categories, homeLocation, localMapSearch, MAX_QUERY_LENGTH, parseSearchLocation, searchPath, searchScopes, withoutSiteOperators, type SearchLocation } from './navigation'
import { PlacesAnswer, PlacesLocation } from './PlacesAnswer'
import { placeIntent } from './places'
import { compatibleProviders, loadPreferences, preferencesStorageKey, providerOrder, savePreferences, type DomainRule, type Preferences } from './preferences'
import { QuickAnswer } from './QuickAnswer'
import { ReusableImageControls } from './ReusableImageControls'
import type { ReusableImageFilters } from './reusable-images'
import { firstVisibleResultUrl, groupResults, resultEntries, visibleEntries } from './result-order'
import { useRecentQueries } from './recent-queries'
import { Results } from './Results'
import { SearchBox } from './SearchBox'
import { SearchFilters } from './SearchFilters'
import { Bangs, BrowserSetup, Modal, Settings, Shortcuts, type Panel } from './Settings'
import { suggestedSpelling } from './spelling'
import { UnitConversion } from './UnitConversion'
import { useCurrencyQuote } from './use-currency'
import { useImageBrowse } from './use-image-browse'
import { usePlaces } from './use-places'
import { useSearch } from './use-search'
import { WeatherAnswer } from './WeatherAnswer'
import { useWeatherAlerts, useWeatherAnswer, weatherLocation } from './weather'

const smiley = new URL('../../web/public/pulpo-smiley.png', import.meta.url).href
const labels = { web: 'Web', images: 'Images', news: 'News', videos: 'Videos', podcasts: 'Podcasts' } as const
const icons = { web: Globe2, images: Image, news: Newspaper, videos: Video, podcasts: Podcast }
const isBangDiscovery = (query: string) => /^[!\s]+$/u.test(query)
const answerPath = (location: SearchLocation) => searchPath({ ...location, page: undefined, provider: undefined })

function PulpoMark({ size }: { size: number }) {
  return <img src={smiley} width={size} height={size} alt="" className="pulpo-mark" />
}

function Logo({ onHome }: { onHome: () => void }) {
  return <a className="wordmark" href="/" aria-label="Pulpo Search home" onClick={event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    onHome()
  }}><PulpoMark size={27} /> <span>Pulpo Search</span></a>
}

function LoadingResults({ firstResult = false }: { firstResult?: boolean }) {
  return (
    <div className="skeleton-list" role="status" aria-label={firstResult ? 'Opening first result' : 'Searching'}>
      {[0, 1, 2, 3].map(index => (
        <div className="skeleton" key={index} aria-hidden="true"><span /><span /><span /></div>
      ))}
    </div>
  )
}

type Callback = ReturnType<typeof consumeCallback>

export function App({ callback }: { callback: Callback }) {
  const [location, setLocation] = useState(() => parseSearchLocation(new URL(window.location.href)))
  const [draft, setDraft] = useState(firstResultQuery(location.query) ?? location.query)
  const [preferences, setPreferences] = useState(loadPreferences)
  const [searchPreferences, setSearchPreferences] = useState(preferences)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [user, setUser] = useState<SearchUser | null | undefined>(undefined)
  const [authError, setAuthError] = useState(callback && 'error' in callback ? callback.error : '')
  const [authBusy, setAuthBusy] = useState(false)
  const [authAttempt, setAuthAttempt] = useState(0)
  const [config, setConfig] = useState<SearchConfig>()
  const [configError, setConfigError] = useState('')
  const [configAttempt, setConfigAttempt] = useState(0)
  const [answerWithWeb, setAnswerWithWeb] = useState<{ userId: string; path: string; expanded: boolean }>()
  const [, refreshInstantAnswer] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const activePreferences = useRef(preferences)
  const callbackRef = useRef(callback && 'code' in callback ? callback : null)
  const accountMenu = useRef<HTMLDetailsElement>(null)
  const luckyRedirect = useRef('')
  useSearchAppearance(user?.id, preferences.theme)
  const { recentQueries, rememberQuery, clearRecentQueries } = useRecentQueries(user?.id, preferences.rememberRecentQueries)

  useEffect(() => {
    function onPopState() {
      const next = parseSearchLocation(new URL(window.location.href))
      setLocation(next)
      setDraft(firstResultQuery(next.query) ?? next.query)
      setSearchPreferences(activePreferences.current)
      setAnswerWithWeb(previous => previous?.path === answerPath(next) ? previous : undefined)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    function syncPreferences(event: StorageEvent) {
      if (event.key !== null && event.key !== preferencesStorageKey) return
      const next = loadPreferences()
      activePreferences.current = next
      setPreferences(next)
    }
    window.addEventListener('storage', syncPreferences)
    return () => window.removeEventListener('storage', syncPreferences)
  }, [])

  useEffect(() => {
    const current = callbackRef.current
    callbackRef.current = null
    const controller = new AbortController()
    const session = current ? api.exchange(current.code, current.codeVerifier) : api.session(controller.signal)
    session.then(result => {
      if (!controller.signal.aborted) setUser(result.user)
    }).catch(error => {
      if (controller.signal.aborted) return
      setUser(null)
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed. Try again.')
    })
    return () => controller.abort()
  }, [authAttempt])

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    api.config(controller.signal).then(result => {
      if (!controller.signal.aborted) setConfig(result)
    }).catch(error => {
      if (controller.signal.aborted) return
      if (error instanceof SearchApiError && error.status === 401) {
        setUser(null)
      } else {
        setConfigError(error instanceof Error ? error.message : 'Search options are unavailable.')
      }
    })
    return () => controller.abort()
  }, [user, configAttempt])

  const bang = location.query ? resolveBang(location.query, preferences.bangs) : null
  const luckyQuery = bang ? null : firstResultQuery(location.query)
  const bangDiscovery = isBangDiscovery(location.query)
  const view = useMemo(() => bangDiscovery ? homeLocation
    : luckyQuery ? { ...location, query: luckyQuery, category: 'web' as const, page: undefined, reusableImages: undefined } : location,
  [bangDiscovery, luckyQuery, location])
  const companion = answerWithWeb?.userId === user?.id && answerWithWeb?.path === answerPath(view) ? answerWithWeb : undefined
  const allowAnswers = !bang && !luckyQuery && view.category === 'web'
    && !view.scope && !view.region && !view.date && !view.dateRange && !view.invalidDateRange && !view.web
    && (companion?.expanded || (!view.page && !view.provider))
  const localAnswer = allowAnswers ? instantAnswer(view.query) : undefined
  const currencyQuery = allowAnswers && !localAnswer && config?.currency ? parseCurrencyQuery(view.query) : undefined
  const currencyQuote = useCurrencyQuote(currencyQuery, user?.id)
  const currencyPending = !!(user && currencyQuery && currencyQuote === undefined)
  const showCurrency = currencyQuote?.status === 'converted'
  const forecastLocation = allowAnswers && !localAnswer && !currencyQuery && config?.weather ? weatherLocation(view.query) : undefined
  const forecast = useWeatherAnswer(forecastLocation, user?.id)
  const forecastPending = !!(user && forecastLocation && forecast === undefined)
  const showForecast = forecast?.status === 'forecast' || forecast?.status === 'ambiguous'
  const alerts = useWeatherAlerts(forecast?.status === 'forecast' ? forecastLocation : undefined, user?.id)
  const localIntent = allowAnswers && config?.places && searchPreferences.localPlaces && !forecastLocation && !localAnswer && !currencyQuery
    ? placeIntent(view.query) : undefined
  const choosePlaceLocation = user ? localIntent?.needsLocation : undefined
  const { result: placeResult, retry: retryPlaces } = usePlaces(choosePlaceLocation ? undefined : localIntent, user?.id)
  const placesError = placeResult instanceof SearchApiError ? placeResult : undefined
  const places = placeResult instanceof SearchApiError ? undefined : placeResult
  const placesPending = !!(user && localIntent && !choosePlaceLocation && placeResult === undefined)
  const showPlaces = !!(places && (places.results.length || localIntent?.openNow))
  const showUnavailableForecast = forecast?.status === 'unavailable'
  const answerPending = forecastPending || currencyPending || placesPending
  const showAnswer = !!localAnswer || showForecast || showCurrency || showPlaces || !!choosePlaceLocation || showUnavailableForecast || !!placesError
  const keepCompanionLookup = !!companion && (showPlaces || forecast?.status === 'forecast')
  const webAlongsideAnswer = keepCompanionLookup && companion?.expanded === true
  const showWebResults = !view.invalidDateRange && (webAlongsideAnswer || (!showAnswer && !forecastPending && !placesPending))
  const mapSearch = view.category === 'web' && !view.scope && !luckyQuery && (!showAnswer || placesError) && !answerPending
    ? localMapSearch(view.query) : undefined
  const refreshAt = localAnswer?.refreshAt
  useEffect(() => {
    if (!refreshAt) return
    const timer = window.setTimeout(() => refreshInstantAnswer(value => value + 1), Math.max(0, refreshAt - Date.now()) + 25)
    return () => window.clearTimeout(timer)
  }, [refreshAt])
  const order = !config ? [] : view.provider
    ? config.providers.filter(provider => provider.id === view.provider).map(provider => provider.id)
    : providerOrder(searchPreferences, config)
  const alternatives = config?.providers.filter(provider => provider.categories.includes(view.category)
    && (provider.maxPage ?? 1) >= (view.page ?? 1)
    && (!view.date || provider.dates.includes(view.date))
    && (!view.dateRange || provider.customDateRanges?.includes(view.category))
    && (!view.region || provider.region)) ?? []
  const chosen = config?.providers.filter(provider => order.includes(provider.id)) ?? []
  const compatible = config ? compatibleProviders(config, order, view) : []
  const categoryProviders = chosen.filter(provider => provider.categories.includes(view.category))
  const enabledCategories = categories.filter(category => chosen.some(provider => provider.categories.includes(category))
    || (category === 'images' && config?.reusableImages))
  const mediaCategories = enabledCategories.filter(category => category === 'videos' || category === 'podcasts')
  const filterDates = [...new Set(categoryProviders.flatMap(provider => provider.dates))]
  const filterCustomDates = categoryProviders.some(provider => provider.customDateRanges?.includes(view.category))
  const filterRegion = categoryProviders.some(provider => provider.region)
  const recoveryProviders = alternatives.filter(provider => !order.includes(provider.id))
  const reuse = view.category === 'images' ? view.reusableImages : undefined
  const { state, refresh } = useSearch(user?.id, reuse ? config?.reusableImages && view.query.length <= 200 && !view.invalidDateRange ? {
    reusable: true, query: view.query, page: view.page, ...reuse,
  } : null : view.query && compatible.length && !bang && (!showAnswer || keepCompanionLookup) && !answerPending && !view.invalidDateRange ? {
    query: view.query,
    providers: order.filter(id => compatible.some(provider => provider.id === id)),
    category: view.category,
    date: view.date || undefined,
    ...(view.dateRange ? { dateRange: view.dateRange } : {}),
    region: view.region || undefined,
    scope: view.category === 'web' ? view.scope : undefined,
    page: view.page,
    limit: searchPreferences.limit,
    ...(view.category === 'images' && compatible.some(provider => provider.expandedImages) ? { expandedImages: true as const } : {}),
  } : null)
  const imageBrowse = useImageBrowse(view.category === 'images' && user
    ? JSON.stringify([user.id, searchPath({ ...view, page: undefined })]) : undefined,
  view.page ?? 1, state.status === 'success' ? state.data : undefined)
  const spelling = state.status === 'success' && view.category === 'web' && !view.page
    ? suggestedSpelling(view.query, state.data) : undefined
  const resultsData = state.status === 'success' && spelling ? {
    ...state.data, related: state.data.related?.filter(query => query !== spelling),
  } : imageBrowse.data
  const askUrl = state.status === 'success' && view.category === 'web' && !luckyQuery
    ? buildAskPulpoUrl(pulpoOrigin, view.query, groupResults(visibleEntries(resultEntries(state.data, preferences), false), view.query)
      .flatMap(({ lead, additional }) => [lead.result, ...additional.map(({ result }) => result)])) : undefined
  const waitingForSession = user === undefined
  const isResults = Boolean(view.query)

  useEffect(() => {
    document.title = view.query ? view.query + ' · Pulpo Search' : 'Pulpo Search'
  }, [view.query])

  useEffect(() => {
    if (!bangDiscovery) return
    window.history.replaceState(null, '', '/')
    setLocation(homeLocation)
    setDraft('')
    setPanel('bangs')
  }, [bangDiscovery])

  useEffect(() => {
    if (!luckyQuery) {
      luckyRedirect.current = ''
      return
    }
    if (state.status !== 'success') return
    const destination = firstVisibleResultUrl(state.data, preferences)
    if (!destination) {
      // Keep the settled request (and any direct answer) while removing the shortcut.
      const next = { ...view, query: luckyQuery }
      window.history.replaceState(null, '', searchPath(next))
      setLocation(next)
      return
    }
    const path = searchPath(location)
    if (luckyRedirect.current === path) return
    luckyRedirect.current = path
    window.location.replace(destination.href)
  }, [location, luckyQuery, preferences, state, view])

  const bangUrl = bang?.url
  useEffect(() => {
    // Address-bar searches and shared bang links use the same redirect as submissions.
    if (bangUrl) window.location.replace(bangUrl)
  }, [bangUrl])

  useEffect(() => {
    if (user && (placesError?.status === 401 || (state.status === 'error' && state.error.status === 401))) {
      setUser(null)
      setConfig(undefined)
    }
  }, [placesError, state, user])

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      const menu = accountMenu.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false
    }
    document.addEventListener('pointerdown', closeAccountMenu)
    return () => document.removeEventListener('pointerdown', closeAccountMenu)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || panel) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('dialog[open]')) return
      const browsingFromSearch = event.key === 'ArrowDown' && target === input.current
        && input.current?.getAttribute('aria-expanded') !== 'true'
      if (!browsingFromSearch && target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, summary, button'))) return
      if (preferences.keyboardShortcuts && event.key === '/') {
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
      const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp'
      const shortcut = preferences.keyboardShortcuts && (event.key === 'j' || event.key === 'k')
      if (!arrow && !shortcut) return
      const links = [...document.querySelectorAll<HTMLAnchorElement>('.result-link')]
      if (!links.length) return
      const current = links.indexOf(document.activeElement as HTMLAnchorElement)
      if (arrow && current < 0 && !browsingFromSearch) return
      event.preventDefault()
      if (arrow && current === 0 && event.key === 'ArrowUp') {
        input.current?.focus()
        return
      }
      const forward = event.key === 'ArrowDown' || event.key === 'j'
      const next = current < 0 && !forward ? links.length - 1 : current + (forward ? 1 : -1)
      links[Math.max(0, Math.min(next, links.length - 1))]?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panel, preferences.keyboardShortcuts])

  function update(next: Preferences) {
    activePreferences.current = next
    setPreferences(next)
    savePreferences(next)
  }

  function setDomain(host: string, rule: DomainRule | undefined) {
    const domains = { ...preferences.domains }
    if (rule) {
      if (!Object.hasOwn(domains, host) && Object.keys(domains).length >= 100) delete domains[Object.keys(domains)[0]]
      domains[host] = rule
    }
    else delete domains[host]
    update({ ...preferences, domains })
  }

  function go(next: SearchLocation) {
    const path = searchPath(next)
    if (path !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', path)
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    setLocation(next)
    setDraft(firstResultQuery(next.query) ?? next.query)
    setSearchPreferences(preferences)
    setAnswerWithWeb(previous => previous?.path === answerPath(next) ? previous : undefined)
  }

  function toggleAnswerWeb() {
    if (!user) return
    if (webAlongsideAnswer && (view.page || view.provider)) {
      go({ ...view, page: undefined, provider: undefined })
      setAnswerWithWeb(undefined)
      return
    }
    setAnswerWithWeb({ userId: user.id, path: answerPath(view), expanded: !webAlongsideAnswer })
  }

  function changeCategory(category: SearchLocation['category']) {
    if (category === view.category) return
    const providers = chosen.filter(provider => provider.categories.includes(category))
    const date = view.date
    const matchingDate = providers.filter(provider => (!date || provider.dates.includes(date))
      && (!view.dateRange || provider.customDateRanges?.includes(category)))
    const reusableImages = category === 'images' && !providers.length && config?.reusableImages ? {} : undefined
    go({
      ...view,
      category,
      page: undefined,
      scope: category === 'web' ? view.scope : undefined,
      date: matchingDate.length ? date : '',
      dateRange: matchingDate.length ? view.dateRange : undefined,
      invalidDateRange: undefined,
      reusableImages,
      region: (matchingDate.length ? matchingDate : providers).some(provider => provider.region) ? view.region : '',
    })
  }

  function changeReusableImages(filters: ReusableImageFilters | undefined) {
    go({ ...view, reusableImages: filters, date: '', dateRange: undefined, invalidDateRange: undefined,
      region: '', provider: undefined, page: undefined })
  }

  function onSearch(query: string) {
    const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH)
    if (!trimmed) {
      go(homeLocation)
      return
    }
    const shortcut = resolveBang(trimmed, preferences.bangs)
    if (shortcut) {
      window.location.assign(shortcut.url)
      return
    }
    if (trimmed === location.query && state.status === 'error') refresh()
    if (isBangDiscovery(trimmed)) {
      setPanel('bangs')
      return
    }
    rememberQuery(firstResultQuery(trimmed) ?? trimmed)
    const restoreInput = !isResults && input.current === document.activeElement
      && window.matchMedia?.('(pointer: fine)').matches
    go({ ...view, query: trimmed, category: firstResultQuery(trimmed) ? 'web' : view.category,
      ...(firstResultQuery(trimmed) ? { reusableImages: undefined } : {}),
      invalidDateRange: undefined, web: undefined, provider: undefined, page: undefined })
    if (restoreInput) requestAnimationFrame(() => input.current?.focus())
  }

  function renderPages(canAdvance = true) {
    if (state.status !== 'success' || (!view.page && !state.data.hasMore)) return null
    return (
      <nav className="page-actions" aria-label="Result pages">
        <button className="secondary-button" disabled={!view.page}
          onClick={() => go({ ...view, page: view.page && view.page > 2 ? view.page - 1 : undefined })}>Previous</button>
        <span>Page {view.page ?? 1}</span>
        <button className="secondary-button" disabled={!canAdvance || !state.data.hasMore || (view.page ?? 1) >= 10}
          onClick={() => go({ ...view, page: (view.page ?? 1) + 1 })}>Next</button>
      </nav>
    )
  }

  async function signIn() {
    setAuthError('')
    setAuthBusy(true)
    try {
      await startSignIn()
    } catch {
      setAuthError('Could not start sign-in. Enable browser storage and try again.')
      setAuthBusy(false)
    }
  }

  async function signOut() {
    setAuthBusy(true)
    setAuthError('')
    try {
      await api.logout()
      setUser(null)
      setConfig(undefined)
      setConfigError('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign out. Try again.')
    } finally {
      if (accountMenu.current) accountMenu.current.open = false
      setAuthBusy(false)
    }
  }

  function handleBang(bang: CustomBang) {
    const query = draft.trim().replace(/^!\S+\s*/, '')
    if (query) onSearch('!' + bang.trigger + ' ' + query)
    else setDraft('!' + bang.trigger + ' ')
    setPanel(null)
    requestAnimationFrame(() => input.current?.focus())
  }

  const searchBox = <SearchBox value={draft} setValue={setDraft} onSearch={onSearch} customBangs={preferences.bangs}
    recentQueries={recentQueries} input={input} />
  const signInButton = <button className="button" onClick={signIn} disabled={authBusy}>Sign in with Pulpo</button>
  const titles = {
    settings: 'Search settings',
    bangs: 'Bangs',
    shortcuts: 'Keyboard shortcuts',
    browser: 'Add to your browser',
  }

  return (
    <div className={isResults ? 'app results-page' : 'app home-page'}>
      <a className="skip-link" href="#main-content">{isResults ? 'Skip to search results' : 'Skip to search'}</a>
      <header className="app-header">
        <div className="app-header-inner">
          {isResults && <Logo onHome={() => { go(homeLocation); requestAnimationFrame(() => input.current?.focus()) }} />}
          {isResults && searchBox}
          <div className="app-actions">
            <button className="icon-button header-settings" aria-label="Search settings" title="Search settings" onClick={() => setPanel('settings')}>
              <Settings2 size={20} aria-hidden="true" />
            </button>
            {user ? (
              <details ref={accountMenu} className="account-menu" onKeyDown={event => {
                if (event.key !== 'Escape' || !event.currentTarget.open) return
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              }}>
                <summary aria-label="Pulpo account" title="Pulpo account">{(user.name || user.email || 'P').trim().charAt(0).toUpperCase()}</summary>
                <div className="account-content">
                  <strong>{user.name || 'Pulpo account'}</strong>
                  <span>{user.email}</span>
                  <a href={pulpoOrigin}>Open Pulpo</a>
                  <button onClick={signOut} disabled={authBusy}>Sign out</button>
                </div>
              </details>
            ) : !waitingForSession && <button className="secondary-button top-signin" onClick={signIn} disabled={authBusy}>Sign in</button>}
          </div>
        </div>
      </header>
      {!isResults ? (
        <main id="main-content" className="home-main">
          <div className="hero">
            <h1><PulpoMark size={54} /> Pulpo Search</h1>
            {searchBox}
            <div className="hero-actions">
              <button onClick={() => setPanel('bangs')} className="text-button"><kbd>!</kbd> Bangs</button>
              {preferences.keyboardShortcuts && <button onClick={() => input.current?.focus()} className="text-button hero-shortcuts"><kbd>/</kbd> Focus search</button>}
            </div>
            {authError && <p className="form-error" role="alert">{authError}</p>}
          </div>
        </main>
      ) : (
        <main id="main-content" className="results-main">
          <div className="results-content">
            <h1 className="sr-only">Search results for {view.query}</h1>
            <div className="filter-bar">
              <div className="categories" aria-label="Search type">
                {(enabledCategories.length ? enabledCategories : [view.category]).map(category => {
                  const Icon = icons[category]
                  return <button key={category} className={'category-button' + (category === 'videos' || category === 'podcasts' ? ' desktop-media-tab' : '')} aria-pressed={category === view.category}
                    onClick={() => changeCategory(category)}><Icon size={16} aria-hidden="true" /> {labels[category]}</button>
                })}
                {mediaCategories.length > 0 && <details className="provider-menu mobile-media-tabs" key={view.category}>
                  <summary className="category-button" aria-label="Media search types" data-active={view.category === 'videos' || view.category === 'podcasts'}>
                    {view.category === 'videos' || view.category === 'podcasts' ? labels[view.category] : 'Media'}
                    <ChevronDown size={13} aria-hidden="true" />
                  </summary>
                  <div className="provider-options">
                    {mediaCategories.map(category => <button key={category} onClick={event => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      changeCategory(category)
                    }}>{labels[category]}</button>)}
                  </div>
                </details>}
              </div>
              <div className="result-controls">
                {mapSearch && <a className="map-search" href={mapSearch} target="_blank" rel="noreferrer">
                  <MapPin size={15} aria-hidden="true" /> Google Maps <ExternalLink size={12} aria-hidden="true" />
                </a>}
                {view.category === 'web' && !showAnswer && !answerPending && user && config && <label className="scope-select">
                  <span className="sr-only">Search focus</span>
                  <select value={view.scope ?? ''} onChange={event => {
                    const scope = searchScopes.find(([id]) => id === event.target.value)?.[0] || undefined
                    go({ ...view, scope, page: undefined })
                  }}>
                    {searchScopes.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
                  </select>
                  <ChevronDown size={13} aria-hidden="true" />
                </label>}
                {!showAnswer && !answerPending && !reuse && <SearchFilters date={view.date} dateRange={view.dateRange} region={view.region}
                  dates={filterDates} allowCustomDates={filterCustomDates} allowRegion={filterRegion}
                  onApply={filters => go({ ...view, ...filters, invalidDateRange: undefined, page: undefined })} />}
              </div>
            </div>
            {view.category === 'images' && !!user && config?.reusableImages && (
              <ReusableImageControls active={!!reuse} filters={reuse ?? {}}
                onToggle={() => changeReusableImages(reuse ? undefined : {})} onFilters={changeReusableImages} />
            )}
            {authError && <p className="form-error results-auth-error" role="alert">{authError}</p>}
            {view.invalidDateRange ? (
              <section className="search-message" role="alert">
                <h2>Invalid date range</h2>
                <p>Choose a start and end date in order, or clear the range.</p>
                <button className="secondary-button" onClick={() => go({ ...view, invalidDateRange: undefined, page: undefined })}>Clear date range</button>
              </section>
            ) : localAnswer?.label === 'Calculator' ? (
              <Calculator key={view.query} initialExpression={localAnswer.expression}
                onSearchWeb={query => go({ ...view, query, web: true })} />
            ) : localAnswer?.label === 'Unit conversion' ? (
              <UnitConversion key={view.query} initialConversion={localAnswer.conversion}
                onConvert={onSearch} onSearchWeb={query => go({ ...view, query, web: true })} />
            ) : localAnswer ? (
              <section className="answer instant-answer" aria-label={localAnswer.label}>
                <h2>{localAnswer.label}</h2>
                <p>{localAnswer.expression}</p>
                <output>{localAnswer.result}</output>
                <button className="text-button" onClick={() => go({ ...view, web: true })}>Search the web</button>
              </section>
            ) : showForecast ? (
              <WeatherAnswer response={forecast} alerts={alerts} onLocation={place => onSearch('weather in ' + place)}
                webExpanded={forecast.status === 'forecast' ? webAlongsideAnswer : undefined}
                onWeb={forecast.status === 'forecast' ? toggleAnswerWeb : () => go({ ...view, web: true })} />
            ) : showCurrency ? (
              <CurrencyAnswer key={view.query} quote={currencyQuote} onConvert={onSearch} onWeb={() => go({ ...view, web: true })} />
            ) : showUnavailableForecast ? (
              <section className="search-message">
                <h2>Forecast unavailable</h2>
                {forecast.place && <p>{[forecast.place.name, forecast.place.admin, forecast.place.country].filter(Boolean).join(', ')}</p>}
                <button className="secondary-button" onClick={() => go({ ...view, web: true })}>Search the web</button>
              </section>
            ) : choosePlaceLocation ? (
              <PlacesLocation onLocation={area => onSearch([choosePlaceLocation.term, choosePlaceLocation.connector, area,
                localIntent?.openNow ? 'open now' : ''].filter(Boolean).join(' '))} onWeb={() => go({ ...view, web: true })} />
            ) : showPlaces && places ? (
              <PlacesAnswer key={view.query} response={places} openNow={!!localIntent?.openNow}
                webExpanded={webAlongsideAnswer} onWeb={toggleAnswerWeb} />
            ) : placesError && placesError.status !== 401 ? (
              <section className="search-message" role="alert">
                <h2>{placesError.status === 402 ? 'Places search limit reached' : 'Couldn’t load places'}</h2>
                <p>{placesError.message}</p>
                <div className="empty-actions">
                  {placesError.status === 402
                    ? <a className="secondary-button" href={pulpoOrigin}>Open Pulpo</a>
                    : <button className="secondary-button" onClick={retryPlaces}>Try again</button>}
                  <button className="secondary-button" onClick={() => go({ ...view, web: true })}>Search the web</button>
                </div>
              </section>
            ) : forecastPending || placesPending ? (
              <section className="search-message">
                <p role="status">{forecastPending ? 'Checking forecast…' : 'Finding places…'}</p>
                <button className="secondary-button" onClick={() => go({ ...view, web: true })}>Search the web</button>
              </section>
            ) : null}
            {showWebResults && (bang || waitingForSession || currencyPending ? <LoadingResults firstResult={Boolean(luckyQuery)} /> : user === null ? (
              <section className="search-message">
                <h2>Sign in to search</h2>
                <p>Use your Pulpo account and shared credits.</p>
                {signInButton}
                {authError && <button className="text-button session-retry" onClick={() => {
                  setAuthError('')
                  setUser(undefined)
                  setAuthAttempt(value => value + 1)
                }}>Check sign-in again</button>}
              </section>
            ) : configError ? (
              <section className="search-message" role="alert">
                <h2>Search is unavailable</h2>
                <p>{configError}</p>
                <button className="secondary-button" onClick={() => { setConfigError(''); setConfigAttempt(value => value + 1) }}>Try again</button>
              </section>
            ) : !config || state.status === 'loading' ? <LoadingResults firstResult={Boolean(luckyQuery)} /> : reuse && (!config.reusableImages || view.query.length > 200) ? (
              <section className="search-message">
                <h2>{config.reusableImages ? 'Shorten your image query' : 'Reusable images are unavailable'}</h2>
                {config.reusableImages && <p>Reusable images supports up to 200 characters.</p>}
                <button className="secondary-button" onClick={() => changeReusableImages(undefined)}>Search all images</button>
              </section>
            ) : !reuse && !order.length ? (
              <section className="search-message"><h2>No search providers available</h2>
                {view.provider ? <button className="secondary-button" onClick={() => go({ ...view, provider: undefined })}>Use default providers</button>
                  : <p>Ask your Pulpo administrator to enable a search provider.</p>}
              </section>
            ) : !reuse && !compatible.length ? (
              <section className="search-message"><h2>These filters are unavailable</h2><p>Try Web results with no filters.</p>
                <button className="secondary-button" onClick={() => go({
                  ...view, category: 'web', date: '', dateRange: undefined, region: '', page: undefined,
                })}>Reset filters</button>
              </section>
            ) : state.status === 'success' && luckyQuery ? <LoadingResults firstResult /> : state.status === 'success' ? (
              <>
                {!reuse && <div className="results-summary">
                  {askUrl && <a className="text-button ask-pulpo-link" href={askUrl} target="_blank" rel="noopener noreferrer">
                    <Sparkles size={14} aria-hidden="true" /> Ask Pulpo <ExternalLink size={12} aria-hidden="true" />
                  </a>}
                  <details className="provider-menu" key={searchPath(view)} onKeyDown={event => {
                    if (event.key !== 'Escape' || !event.currentTarget.open) return
                    event.currentTarget.open = false
                    event.currentTarget.querySelector('summary')?.focus()
                  }}>
                    <summary className="text-button provider-indicator" aria-label="Search providers">
                      {providerNames[state.data.provider]} <ChevronDown size={13} aria-hidden="true" />
                    </summary>
                    <div className="provider-options">
                      {alternatives.filter(provider => provider.id !== state.data.provider).map(provider => (
                        <button key={provider.id} onClick={() => go({ ...view, provider: provider.id })}>Search with {providerNames[provider.id]}</button>
                      ))}
                      {view.provider && <button onClick={() => go({ ...view, provider: undefined })}>Use default providers</button>}
                      <button onClick={event => {
                        const menu = event.currentTarget.closest('details')
                        menu?.removeAttribute('open')
                        menu?.querySelector('summary')?.focus()
                        setPanel('settings')
                      }}>Provider settings</button>
                    </div>
                  </details>
                </div>}
                {spelling && <p className="spelling-suggestion">
                  Did you mean <button className="text-button" onClick={() => onSearch(spelling)}>{spelling}</button>?
                </p>}
                {allowAnswers && config.quickAnswer && (
                  <QuickAnswer key={searchPath(view)} query={view.query} priceMicros={config.quickAnswer.priceMicros} pulpoOrigin={pulpoOrigin} />
                )}
                {!state.data.results.length && !state.data.answer && !state.data.knowledge ? (
                  <section className="search-message">
                    <h2>No results found</h2>
                    <p>Try fewer words or change your filters.</p>
                    <div className="empty-actions">
                      {/"[^"]+"/.test(view.query) && <button className="secondary-button"
                        onClick={() => onSearch(view.query.replace(/"([^"]+)"/g, '$1'))}>Search without quotes</button>}
                      {withoutSiteOperators(view.query) && <button className="secondary-button"
                        onClick={() => onSearch(withoutSiteOperators(view.query))}>Remove site operators</button>}
                      {view.scope && <button className="secondary-button"
                        onClick={() => go({ ...view, scope: undefined, page: undefined })}>Search all sites</button>}
                      {(view.date || view.dateRange || view.region) && <button className="secondary-button"
                        onClick={() => go({ ...view, date: '', dateRange: undefined, region: '', page: undefined })}>Clear date and region</button>}
                      {view.category !== 'web' && <button className="secondary-button" onClick={() => changeCategory('web')}>Try Web results</button>}
                    </div>
                  </section>
                ) : imageBrowse.data?.results.length === 0 ? (
                  <section className="search-message">
                    <h2>No new images on this page</h2>
                    <p>These images are available on earlier pages.</p>
                  </section>
                ) : <Results key={searchPath(view)} data={resultsData ?? state.data} location={view} preferences={preferences}
                  setDomain={setDomain} onQuery={onSearch} imageRefinements={imageBrowse.refinements} imagePagination={renderPages} />}
                {(!imageBrowse.data?.results.length) && renderPages()}
              </>
            ) : state.status === 'error' && state.error.status !== 401 ? (
              <section className="search-message" role="alert">
                <h2>{state.error.status === 402 ? 'Search limit reached' : 'Couldn’t complete the search'}</h2>
                <p>{state.error.message}</p>
                {state.error.status === 402 ? (
                  <a className="secondary-button" href={pulpoOrigin}>Open Pulpo</a>
                ) : (
                  <div className="empty-actions">
                    <button className="secondary-button" onClick={refresh}>Try again</button>
                    {recoveryProviders.map(provider => <button key={provider.id} className="secondary-button"
                      onClick={() => go({ ...location, provider: provider.id })}>Try {providerNames[provider.id]}</button>)}
                    {view.category !== 'web' && <button className="secondary-button" onClick={() => changeCategory('web')}>Try Web results</button>}
                  </div>
                )}
              </section>
            ) : <LoadingResults />)}
          </div>
        </main>
      )}
      <footer className="app-footer">
        <a href={pulpoOrigin}>Pulpo</a>
        <div>
          {isResults && <button onClick={() => setPanel('bangs')}>Bangs</button>}
          <button onClick={() => setPanel('browser')}>Add to browser</button>
          <button className="footer-keyboard" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setPanel('shortcuts')}><Keyboard size={18} /></button>
        </div>
      </footer>
      {panel && (
        <Modal title={titles[panel]} close={() => setPanel(null)}>
          {panel === 'settings' && <Settings config={config} preferences={preferences} update={update}
            recentQueryCount={recentQueries.length} clearRecentQueries={clearRecentQueries} />}
          {panel === 'bangs' && <Bangs customBangs={preferences.bangs} update={bangs => update({ ...preferences, bangs })} onChooseBang={handleBang} />}
          {panel === 'shortcuts' && <Shortcuts singleKeys={preferences.keyboardShortcuts} />}
          {panel === 'browser' && <BrowserSetup />}
        </Modal>
      )}
    </div>
  )
}
