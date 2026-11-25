import { Globe2, Image, Keyboard, Newspaper, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, providerNames, SearchApiError, type SearchConfig, type SearchUser } from './api'
import { consumeCallback, pulpoOrigin, startSignIn } from './auth'
import { resolveBang, type CustomBang } from './bangs'
import { categories, dateOptions, homeLocation, MAX_QUERY_LENGTH, parseSearchLocation, regions, searchPath, type SearchLocation } from './navigation'
import { compatibleProviders, loadPreferences, providerOrder, savePreferences, type DomainRule, type Preferences } from './preferences'
import { Results } from './Results'
import { SearchBox } from './SearchBox'
import { Bangs, BrowserSetup, Modal, Settings, Shortcuts, type Panel } from './Settings'
import { useSearch } from './use-search'

const smiley = new URL('../../web/public/pulpo-smiley.png', import.meta.url).href
const labels = { web: 'Web', images: 'Images', news: 'News' } as const
const icons = { web: Globe2, images: Image, news: Newspaper }

function PulpoMark({ size }: { size: number }) {
  return <img src={smiley} width={size} height={size} alt="" className="pulpo-mark" />
}

function Logo({ home, onHome }: { home: boolean; onHome: () => void }) {
  return <a className={'wordmark' + (home ? ' wordmark-home' : '')} href="/" onClick={event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    onHome()
  }}><PulpoMark size={25} /> <span>Pulpo Search</span></a>
}

function LoadingResults() {
  return (
    <div className="skeleton-list" role="status" aria-label="Searching">
      {[0, 1, 2, 3].map(index => (
        <div className="skeleton" key={index} aria-hidden="true"><span /><span /><span /></div>
      ))}
    </div>
  )
}

type Callback = ReturnType<typeof consumeCallback>

export function App({ callback }: { callback: Callback }) {
  const [location, setLocation] = useState(() => parseSearchLocation(new URL(window.location.href)))
  const [draft, setDraft] = useState(location.query)
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

  useEffect(() => {
    function onPopState() {
      const next = parseSearchLocation(new URL(window.location.href))
      setLocation(next)
      setDraft(next.query)
      setSearchPreferences(activePreferences.current)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.title = location.query ? location.query + ' · Pulpo Search' : 'Pulpo Search'
  }, [location.query])

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

  useEffect(() => {
    const element = document.documentElement
    if (preferences.theme === 'system') delete element.dataset.theme
    else element.dataset.theme = preferences.theme
  }, [preferences.theme])

  const order = config ? providerOrder(searchPreferences, config) : []
  const chosen = config?.providers.filter(provider => order.includes(provider.id)) ?? []
  const compatible = config ? compatibleProviders(config, order, location) : []
  const categoryProviders = chosen.filter(provider => provider.categories.includes(location.category))
  const enabledCategories = categories.filter(category => chosen.some(provider => provider.categories.includes(category)))
  const useDates = categoryProviders.some(provider => provider.dates.length > 0)
  const useRegion = categoryProviders.some(provider => provider.region)
  const bang = location.query ? resolveBang(location.query, preferences.bangs) : null
  const { state, refresh } = useSearch(user?.id, location.query && compatible.length && !bang ? {
    query: location.query,
    providers: order.filter(id => compatible.some(provider => provider.id === id)),
    category: location.category,
    date: location.date || undefined,
    region: location.region || undefined,
    limit: searchPreferences.limit,
  } : null)
  const waitingForSession = user === undefined
  const isResults = Boolean(location.query)

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
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || panel) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
      if (event.key === '/') {
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
      if (event.key !== 'j' && event.key !== 'k') return
      const links = [...document.querySelectorAll<HTMLAnchorElement>('.result-link')]
      if (!links.length) return
      event.preventDefault()
      const current = links.indexOf(document.activeElement as HTMLAnchorElement)
      const next = current < 0 && event.key === 'k' ? links.length - 1 : current + (event.key === 'j' ? 1 : -1)
      links[Math.max(0, Math.min(next, links.length - 1))]?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panel])

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
    setDraft(next.query)
    setSearchPreferences(preferences)
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
    go({ ...location, query: trimmed })
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
        <Logo home={!isResults} onHome={() => { go(homeLocation); requestAnimationFrame(() => input.current?.focus()) }} />
        {isResults && searchBox}
        <div className="app-actions">
          <button className="icon-button header-settings" aria-label="Search settings" title="Search settings" onClick={() => setPanel('settings')}>
            <Settings2 size={20} aria-hidden="true" />
          </button>
          {user ? (
            <details ref={accountMenu} className="account-menu">
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
      </header>
      {!isResults ? (
        <main id="main-content" className="home-main">
          <div className="hero">
            <h1><PulpoMark size={51} /> Pulpo Search</h1>
            {searchBox}
            <div className="hero-actions">
              <button onClick={() => setPanel('bangs')} className="text-button"><code>!</code> Bangs</button>
              <button onClick={() => input.current?.focus()} className="text-button hero-shortcuts"><kbd>/</kbd> Focus search</button>
            </div>
            {authError && <p className="form-error" role="alert">{authError}</p>}
          </div>
        </main>
      ) : (
        <main id="main-content" className="results-main">
          <h1 className="sr-only">Search results for {location.query}</h1>
          <div className="filter-bar">
            <div className="categories" aria-label="Search type">
              {(enabledCategories.length ? enabledCategories : [location.category]).map(category => {
                const Icon = icons[category]
                return <button key={category} className="category-button" aria-pressed={category === location.category}
                  onClick={() => { if (category !== location.category) go({ ...location, category, date: '', region: '' }) }}><Icon size={16} /> {labels[category]}</button>
              })}
            </div>
            <div className="filter-controls">
              {useDates && <select aria-label="Date range" title="Date range" value={location.date} onChange={event => {
                go({ ...location, date: event.target.value as SearchLocation['date'] })
              }}>
                {dateOptions.filter(([value]) => !value || categoryProviders.some(p => p.dates.includes(value)) || value === location.date)
                  .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>}
              {useRegion && <select aria-label="Region" title="Region" value={location.region} onChange={event => {
                go({ ...location, region: event.target.value })
              }}>{regions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
            </div>
          </div>
          {authError && <p className="form-error results-auth-error" role="alert">{authError}</p>}
          {bang || waitingForSession ? <LoadingResults /> : user === null ? (
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
          ) : !config || state.status === 'loading' ? <LoadingResults /> : !order.length ? (
            <section className="search-message"><h2>No search providers available</h2><p>Ask your Pulpo administrator to enable a search provider.</p></section>
          ) : !compatible.length ? (
            <section className="search-message"><h2>These filters are unavailable</h2><p>Try Web results with no filters.</p>
              <button className="secondary-button" onClick={() => go({ ...location, category: 'web', date: '', region: '' })}>Reset filters</button>
            </section>
          ) : state.status === 'success' ? (
            <>
              <div className="results-summary">
                <span>{state.data.results.length ? `${state.data.results.length} ${state.data.results.length === 1 ? 'result' : 'results'}` : ''}</span>
                <button className="text-button" onClick={() => setPanel('settings')}>Via {providerNames[state.data.provider]}</button>
              </div>
              <Results key={searchPath(location)} data={state.data} location={location} preferences={preferences}
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
          {panel === 'shortcuts' && <Shortcuts />}
          {panel === 'browser' && <BrowserSetup />}
        </Modal>
      )}
    </div>
  )
}
