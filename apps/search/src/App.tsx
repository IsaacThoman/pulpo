import { ChevronDown, Globe2, Image, Keyboard, Newspaper, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, providerNames, SearchApiError, type SearchConfig, type SearchUser } from './api'
import { useSearchAppearance } from './appearance'
import { consumeCallback, pulpoOrigin, startSignIn } from './auth'
import { firstResultQuery, resolveBang, type CustomBang } from './bangs'
import { categories, homeLocation, MAX_QUERY_LENGTH, parseSearchLocation, searchPath, type SearchLocation } from './navigation'
import { compatibleProviders, loadPreferences, providerOrder, savePreferences, type DomainRule, type Preferences } from './preferences'
import { firstVisibleResultUrl } from './result-order'
import { Results } from './Results'
import { SearchBox } from './SearchBox'
import { SearchFilters } from './SearchFilters'
import { Bangs, BrowserSetup, Modal, Settings, Shortcuts, type Panel } from './Settings'
import { useSearch } from './use-search'

const smiley = new URL('../../web/public/pulpo-smiley.png', import.meta.url).href
const labels = { web: 'Web', images: 'Images', news: 'News' } as const
const icons = { web: Globe2, images: Image, news: Newspaper }
const isBangDiscovery = (query: string) => /^[!\s]+$/u.test(query)

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
  const input = useRef<HTMLInputElement>(null)
  const activePreferences = useRef(preferences)
  const callbackRef = useRef(callback && 'code' in callback ? callback : null)
  const accountMenu = useRef<HTMLDetailsElement>(null)
  const luckyRedirect = useRef('')
  useSearchAppearance(user?.id, preferences.theme)

  useEffect(() => {
    function onPopState() {
      const next = parseSearchLocation(new URL(window.location.href))
      setLocation(next)
      setDraft(firstResultQuery(next.query) ?? next.query)
      setSearchPreferences(activePreferences.current)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
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
  const view = bangDiscovery ? homeLocation : luckyQuery ? { ...location, query: luckyQuery, category: 'web' as const } : location
  const order = config ? providerOrder(searchPreferences, config) : []
  const chosen = config?.providers.filter(provider => order.includes(provider.id)) ?? []
  const compatible = config ? compatibleProviders(config, order, view) : []
  const categoryProviders = chosen.filter(provider => provider.categories.includes(view.category))
  const enabledCategories = categories.filter(category => chosen.some(provider => provider.categories.includes(category)))
  const filterDates = [...new Set(categoryProviders.flatMap(provider => provider.dates))]
  const filterRegion = categoryProviders.some(provider => provider.region)
  const { state, refresh } = useSearch(user?.id, view.query && compatible.length && !bang ? {
    query: view.query,
    providers: order.filter(id => compatible.some(provider => provider.id === id)),
    category: view.category,
    date: view.date || undefined,
    region: view.region || undefined,
    limit: searchPreferences.limit,
  } : null)
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
      const next = { ...location, query: luckyQuery, category: 'web' as const }
      window.history.replaceState(null, '', searchPath(next))
      setLocation(next)
      return
    }
    const path = searchPath(location)
    if (luckyRedirect.current === path) return
    luckyRedirect.current = path
    window.location.replace(destination.href)
  }, [location, luckyQuery, preferences, state])

  const bangUrl = bang?.url
  useEffect(() => {
    // Address-bar searches and shared bang links use the same redirect as submissions.
    if (bangUrl) window.location.replace(bangUrl)
  }, [bangUrl])

  useEffect(() => {
    if (state.status === 'error' && state.error.status === 401 && user) {
      setUser(null)
      setConfig(undefined)
    }
  }, [state, user])

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
  }

  function changeCategory(category: SearchLocation['category']) {
    if (category === view.category) return
    const providers = chosen.filter(provider => provider.categories.includes(category))
    const date = view.date
    const matchingDate = date ? providers.filter(provider => provider.dates.includes(date)) : providers
    go({
      ...view,
      category,
      date: matchingDate.length ? date : '',
      region: (matchingDate.length ? matchingDate : providers).some(provider => provider.region) ? view.region : '',
    })
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
    const restoreInput = !isResults && input.current === document.activeElement
      && window.matchMedia?.('(pointer: fine)').matches
    go({ ...view, query: trimmed, category: firstResultQuery(trimmed) ? 'web' : view.category })
    if (restoreInput) requestAnimationFrame(() => input.current?.focus())
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

  const searchBox = <SearchBox value={draft} setValue={setDraft} onSearch={onSearch} customBangs={preferences.bangs} input={input} />
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
                  return <button key={category} className="category-button" aria-pressed={category === view.category}
                    onClick={() => changeCategory(category)}><Icon size={16} aria-hidden="true" /> {labels[category]}</button>
                })}
              </div>
              <SearchFilters date={view.date} region={view.region} dates={filterDates} allowRegion={filterRegion}
                onApply={filters => go({ ...view, ...filters })} />
            </div>
            {authError && <p className="form-error results-auth-error" role="alert">{authError}</p>}
            {bang || waitingForSession ? <LoadingResults firstResult={Boolean(luckyQuery)} /> : user === null ? (
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
            ) : !config || state.status === 'loading' ? <LoadingResults firstResult={Boolean(luckyQuery)} /> : !order.length ? (
              <section className="search-message"><h2>No search providers available</h2><p>Ask your Pulpo administrator to enable a search provider.</p></section>
            ) : !compatible.length ? (
              <section className="search-message"><h2>These filters are unavailable</h2><p>Try Web results with no filters.</p>
                <button className="secondary-button" onClick={() => go({ ...view, category: 'web', date: '', region: '' })}>Reset filters</button>
              </section>
            ) : state.status === 'success' && luckyQuery ? <LoadingResults firstResult /> : state.status === 'success' ? (
              <>
                <div className="results-summary">
                  <button className="text-button provider-indicator" onClick={() => setPanel('settings')} title="Search providers">
                    {providerNames[state.data.provider]} <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </div>
                <Results key={searchPath(view)} data={state.data} location={view} preferences={preferences}
                  setDomain={setDomain} onQuery={onSearch} />
              </>
            ) : state.status === 'error' && state.error.status !== 401 ? (
              <section className="search-message" role="alert">
                <h2>{state.error.status === 402 ? 'Search limit reached' : 'Couldn’t complete the search'}</h2>
                <p>{state.error.message}</p>
                {state.error.status === 402 ? (
                  <a className="secondary-button" href={pulpoOrigin}>Open Pulpo</a>
                ) : <button className="secondary-button" onClick={refresh}>Try again</button>}
              </section>
            ) : <LoadingResults />}
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
          {panel === 'settings' && <Settings config={config} preferences={preferences} update={update} />}
          {panel === 'bangs' && <Bangs customBangs={preferences.bangs} update={bangs => update({ ...preferences, bangs })} onChooseBang={handleBang} />}
          {panel === 'shortcuts' && <Shortcuts singleKeys={preferences.keyboardShortcuts} />}
          {panel === 'browser' && <BrowserSetup />}
        </Modal>
      )}
    </div>
  )
}
