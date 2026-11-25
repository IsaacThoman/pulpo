import { ChevronDown, Copy, Globe2, ListFilter, Monitor, Settings2, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import type { SearchProviderCategory } from '@pulpo/contracts/search'
import { formatSearchPrice, providerNames, type Provider, type SearchConfig } from './api'
import { searchBangs, validateCustomBang, type CustomBang } from './bangs'
import { categories, regions } from './navigation'
import { placeProviderNames } from './places'
import { providerOrder, type Preferences } from './preferences'
import type { SearchPreferencesSyncStatus } from './use-search-preferences'

export type Panel = 'settings' | 'bangs' | 'shortcuts' | 'browser'

export function Modal({ title, close, children, settings = false }: { title: string; close: () => void; children: ReactNode; settings?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    const opener = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected
        && (document.activeElement === document.body || element.contains(document.activeElement))) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className={settings ? 'dialog settings-dialog' : 'dialog'}
      aria-labelledby="dialog-title"
      onCancel={event => { event.preventDefault(); close() }}
      onClick={event => { if (event.target === event.currentTarget) close() }}
    >
      <section className="dialog-content">
        <header className="dialog-header">
          <h2 id="dialog-title">{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Close"><X size={19} /></button>
        </header>
        {children}
      </section>
    </dialog>
  )
}

interface SettingsProps {
  config: SearchConfig | undefined
  preferences: Preferences
  update: (next: Preferences) => void
  syncStatus: SearchPreferencesSyncStatus
  retrySync: () => void
  recentQueryCount: number
  clearRecentQueries: () => void
}

const categoryLabels = { images: 'Images', news: 'News', videos: 'Videos', podcasts: 'Podcasts' } as const

/** Engine choices for a search type that more than one available engine supports. */
function CategoryProviders({ category, config, preferences, update }: {
  category: SearchProviderCategory
  config: SearchConfig
  preferences: Preferences
  update: (next: Preferences) => void
}) {
  const supported = config.providers.filter(provider => provider.categories.includes(category)).map(provider => provider.id)
  const choice = preferences.categoryProviders[category]
  const inherited = providerOrder({ ...preferences, categoryProviders: {} }, config, category).find(provider => supported.includes(provider))
  const automaticNews = category === 'news' && !preferences.defaultProvider && !preferences.fallbackProvider
  const primary = choice && supported.includes(choice.defaultProvider) ? choice.defaultProvider : undefined
  const label = categoryLabels[category]
  const pager = config.providers.find(provider => provider.id !== primary && provider.categories.includes(category) && (provider.maxPage ?? 1) > 1)
  const singlePage = primary && (config.providers.find(provider => provider.id === primary)?.maxPage ?? 1) <= 1
  function choose(next: Preferences['categoryProviders'][SearchProviderCategory]) {
    const categoryProviders = { ...preferences.categoryProviders }
    if (next) categoryProviders[category] = next
    else delete categoryProviders[category]
    update({ ...preferences, categoryProviders })
  }
  return (
    <fieldset className="settings-subgroup">
      <legend>{label}</legend>
      <div className="settings-row">
        <label htmlFor={`search-provider-${category}-default`}>Default</label>
        <SettingsSelect id={`search-provider-${category}-default`} value={primary ?? ''} onChange={event => {
          const provider = supported.find(id => id === event.target.value)
          choose(provider ? { defaultProvider: provider, fallbackProvider: choice?.fallbackProvider ?? '' } : undefined)
        }}>
          <option value="">{automaticNews ? 'Pulpo default' : 'Same as Web'}{inherited ? ' · ' + providerNames[inherited] : ''}</option>
          {supported.map(provider => <option key={provider} value={provider}>{providerNames[provider]}</option>)}
        </SettingsSelect>
      </div>
      {primary && <div className="settings-row">
        <label htmlFor={`search-provider-${category}-fallback`}>Fallback</label>
        <SettingsSelect id={`search-provider-${category}-fallback`}
          value={choice?.fallbackProvider === 'none' || supported.some(provider => provider === choice?.fallbackProvider && provider !== primary)
            ? choice?.fallbackProvider : ''}
          onChange={event => {
            const value = event.target.value
            const fallbackProvider = value === 'none' ? 'none' : supported.find(id => id === value && id !== primary) ?? ''
            choose({ defaultProvider: primary, fallbackProvider })
          }}>
          <option value="">Automatic</option>
          {supported.filter(provider => provider !== primary).map(provider => <option key={provider} value={provider}>{providerNames[provider]}</option>)}
          <option value="none">Off</option>
        </SettingsSelect>
      </div>}
      {singlePage && pager && <p className="hint">{providerNames[primary]} returns one set of {label.toLowerCase()}. Load more continues with {providerNames[pager.id]}.</p>}
    </fieldset>
  )
}

const settingsSections = [
  { id: 'providers', label: 'Providers', icon: Settings2 },
  { id: 'results', label: 'Results', icon: ListFilter },
  { id: 'browser', label: 'Browser', icon: Monitor },
  { id: 'sites', label: 'Sites', icon: Globe2 },
] as const

function SettingsSelect(props: ComponentProps<'select'>) {
  return <span className="filter-select settings-select">
    <select {...props} />
    <ChevronDown size={14} aria-hidden="true" />
  </span>
}

export function Settings({ config, preferences, update, syncStatus, retrySync, recentQueryCount, clearRecentQueries }: SettingsProps) {
  const [section, setSection] = useState<(typeof settingsSections)[number]['id']>('providers')
  const preferencesScroll = useRef<HTMLDivElement>(null)
  const activePrimary = config ? providerOrder(preferences, config)[0] : undefined
  const domainEntries = Object.entries(preferences.domains).sort(([a], [b]) => a.localeCompare(b))
  const available = config?.providers.map(provider => provider.id) ?? []
  const primaryLabel = config?.defaultOrder[0]
  const searchPrice = config?.providers.find(provider => provider.id === activePrimary)?.priceMicros ?? 0
  const publisherNewsPrice = config?.providers.find(provider => provider.id === 'firecrawl')?.newsPriceMicros
  const ownEngineCategories = categories.filter((category): category is SearchProviderCategory => category !== 'web'
    && (config?.providers.filter(provider => provider.categories.includes(category)).length ?? 0) > 1)
  return (
    <div className="settings-layout">
      <nav className="settings-navigation" aria-label="Settings sections">
        {settingsSections.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => {
            setSection(id)
            if (preferencesScroll.current) preferencesScroll.current.scrollTop = 0
          }}><Icon size={16} aria-hidden="true" />{label}</button>
        ))}
      </nav>
      <div className="settings-preferences" ref={preferencesScroll}>
        <fieldset className="settings-group" hidden={section !== 'providers'}>
          <legend>Search providers</legend>
          {available.length > 0 ? (
            <>
              <fieldset className="settings-subgroup">
                <legend className={ownEngineCategories.length ? undefined : 'sr-only'}>Web</legend>
                <div className="settings-row">
                  <label htmlFor="search-provider-default">Default</label>
                  <SettingsSelect id="search-provider-default" value={available.includes(preferences.defaultProvider as Provider) ? preferences.defaultProvider : ''}
                    onChange={event => update({ ...preferences, defaultProvider: event.target.value as Preferences['defaultProvider'] })}>
                    <option value="">Pulpo default{primaryLabel ? ' · ' + providerNames[primaryLabel] : ''}</option>
                    {available.map(provider => <option key={provider} value={provider}>{providerNames[provider]}</option>)}
                  </SettingsSelect>
                </div>
                <div className="settings-row">
                  <label htmlFor="search-provider-fallback">Fallback</label>
                  <SettingsSelect id="search-provider-fallback" value={preferences.fallbackProvider === 'none' || available.some(
                    provider => provider === preferences.fallbackProvider && provider !== activePrimary,
                  ) ? preferences.fallbackProvider : ''}
                    onChange={event => update({ ...preferences, fallbackProvider: event.target.value as Preferences['fallbackProvider'] })}>
                    <option value="">Automatic</option>
                    {available.filter(provider => provider !== activePrimary).map(provider => (
                      <option key={provider} value={provider}>{providerNames[provider]}</option>
                    ))}
                    <option value="none">Off</option>
                  </SettingsSelect>
                </div>
              </fieldset>
              {config && ownEngineCategories.map(category => <CategoryProviders key={category} category={category} config={config}
                preferences={preferences} update={update} />)}
              <p className="hint">Provider changes apply to your next search. Pulpo can try your fallback when the default can’t complete it.</p>
              {searchPrice > 0 && <p className="hint">The default provider costs {formatSearchPrice(searchPrice)} per search from your shared Pulpo credits.</p>}
              {publisherNewsPrice && <p className="hint">Firecrawl News includes publisher details when available and costs {formatSearchPrice(publisherNewsPrice)} per search.</p>}
            </>
          ) : <p className="hint">Provider options appear when you’re signed in and search is available.</p>}
          {config?.places && <>
            <label className="settings-row">
              Local places
              <input type="checkbox" role="switch" checked={preferences.localPlaces}
                onChange={event => update({ ...preferences, localPlaces: event.target.checked })} />
            </label>
            <p className="hint">Places searches use {placeProviderNames[config.places.provider]} and cost {formatSearchPrice(config.places.priceMicros)} from your shared Pulpo credits when listings are found.</p>
          </>}
        </fieldset>
        <fieldset className="settings-group" hidden={section !== 'results'}>
          <legend>Search results</legend>
          <div className="settings-row">
            <label htmlFor="search-limit">Results per search</label>
            <SettingsSelect id="search-limit" value={preferences.limit} onChange={event => {
              const limit = Number(event.target.value)
              if (limit === 10 || limit === 20 || limit === 40) update({ ...preferences, limit })
            }}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="40">Up to 40</option>
            </SettingsSelect>
          </div>
          {config?.providers.some(provider => provider.expandedImages) && <p className="hint">Kagi image galleries show more results in batches of 24.</p>}
          <div className="settings-row">
            <label htmlFor="search-region-default">Default region</label>
            <SettingsSelect id="search-region-default" value={preferences.defaultRegion} onChange={event => {
              const region = regions.find(([value]) => value === event.target.value)?.[0]
              if (region !== undefined) update({ ...preferences, defaultRegion: region })
            }}>
              {regions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </SettingsSelect>
          </div>
          <label className="settings-row">
            SafeSearch
            <input type="checkbox" role="switch" checked={preferences.safeSearch} onChange={event => update({ ...preferences, safeSearch: event.target.checked })} />
          </label>
          <label className="settings-row">
            Open links in a new tab
            <input type="checkbox" role="switch" checked={preferences.newTab} onChange={event => update({ ...preferences, newTab: event.target.checked })} />
          </label>
          <label className="settings-row">
            Single-key shortcuts
            <input type="checkbox" role="switch" checked={preferences.keyboardShortcuts}
              onChange={event => update({ ...preferences, keyboardShortcuts: event.target.checked })} />
          </label>
        </fieldset>
        <fieldset className="settings-group" hidden={section !== 'browser'}>
          <legend>This browser</legend>
          <div className="settings-row">
            <label htmlFor="search-theme">Theme</label>
            <SettingsSelect id="search-theme" value={preferences.theme} onChange={event => update({ ...preferences, theme: event.target.value as Preferences['theme'] })}>
              <option value="pulpo">Follow Pulpo</option>
              <option value="system">Follow device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </SettingsSelect>
          </div>
          <label className="settings-row">
            Remember recent searches on this browser
            <input type="checkbox" role="switch" checked={preferences.rememberRecentQueries}
              onChange={event => update({ ...preferences, rememberRecentQueries: event.target.checked })} />
          </label>
          <button className="text-button" disabled={!recentQueryCount} onClick={clearRecentQueries}>Clear recent searches</button>
        </fieldset>
        <fieldset className="settings-group" hidden={section !== 'sites'}>
          <legend>Sites</legend>
          {domainEntries.length ? (
            <ul className="settings-list">
              {domainEntries.map(([domain, rule]) => (
                <li key={domain}>
                  <span className="settings-site">{domain} <small>{rule === 'pin' ? 'Pinned' : 'Hidden'}</small></span>
                  <button className="text-button" aria-label={`Remove preference for ${domain}`} onClick={() => {
                    const domains = { ...preferences.domains }
                    delete domains[domain]
                    update({ ...preferences, domains })
                  }}>Remove</button>
                </li>
              ))}
            </ul>
          ) : <p className="hint">Pin or hide a site from its result menu.</p>}
        </fieldset>
      </div>
      <p className="hint settings-sync" role="status">{syncStatus === 'browser' ? 'Search preferences are saved in this browser.'
        : syncStatus === 'syncing' ? 'Syncing Search preferences…'
        : syncStatus === 'synced' ? 'Search preferences sync with your Pulpo account.'
        : <>Search preferences are saved here until sync is available. <button className="text-button" onClick={retrySync}>Retry sync</button></>}</p>
    </div>
  )
}

interface BangsProps {
  customBangs: CustomBang[]
  update: (bangs: CustomBang[]) => void
  onChooseBang: (bang: CustomBang) => void
}

export function Bangs({ customBangs, update, onChooseBang }: BangsProps) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const matchingBangs = searchBangs(query, customBangs)
  function addBang(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const bang = {
      trigger: String(data.get('trigger') ?? '').trim().replace(/^!/, '').toLowerCase(),
      name: String(data.get('name') ?? '').trim(),
      url: String(data.get('url') ?? '').trim(),
    }
    const validationError = validateCustomBang(bang)
    if (validationError) {
      setError(validationError)
      return
    }
    if (customBangs.some(item => item.trigger === bang.trigger)) {
      setError('You already have a shortcut with this trigger.')
      return
    }
    update([...customBangs, bang])
    setEditing(false)
    setError('')
    setQuery(bang.trigger)
  }
  return (
    <div className="settings">
      <div className="bang-help">
        <p className="hint"><code>!w tide pools</code> searches Wikipedia.</p>
        <p className="hint"><code>tide pools !</code> opens the first web result.</p>
      </div>
      <label className="field-label">
        Find a shortcut
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Wikipedia, GitHub, Maps…" />
      </label>
      {matchingBangs.length ? (
        <ul className="settings-list bang-list">
          {matchingBangs.map(bang => (
            <li key={bang.trigger}>
              <button className="bang-choice" onClick={() => onChooseBang(bang)}>
                <code>!{bang.trigger}</code> {bang.name}
              </button>
              {customBangs.some(item => item.trigger === bang.trigger) && (
                <button className="text-button" aria-label={`Remove shortcut !${bang.trigger}`}
                  onClick={() => update(customBangs.filter(item => item.trigger !== bang.trigger))}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="hint">No matching shortcuts.</p>}
      {editing ? (
        <form className="custom-bang-form" onSubmit={addBang}>
          <label className="field-label">Trigger<input name="trigger" required maxLength={24} placeholder="!manual" /></label>
          <label className="field-label">Name<input name="name" required maxLength={80} placeholder="Project manual" /></label>
          <label className="field-label">
            Search URL
            <input name="url" required maxLength={2_000} placeholder="https://example.com/search?q={query}" />
          </label>
          <p className="hint">Put <code>{'{query}'}</code> where the search terms belong.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button>
            <button className="button" type="submit">Save shortcut</button>
          </div>
        </form>
      ) : (
        <button className="secondary-button" onClick={() => setEditing(true)} disabled={customBangs.length >= 30}>Add a shortcut</button>
      )}
    </div>
  )
}

export function Shortcuts({ singleKeys }: { singleKeys: boolean }) {
  return (
    <dl className="shortcut-list">
      {singleKeys && <div><dt>Focus search</dt><dd><kbd>/</kbd></dd></div>}
      <div><dt>Next result</dt><dd><kbd aria-label="Arrow down">↓</kbd>{singleKeys && <> or <kbd>J</kbd></>}</dd></div>
      <div><dt>Previous result</dt><dd><kbd aria-label="Arrow up">↑</kbd>{singleKeys && <> or <kbd>K</kbd></>}</dd></div>
      <div><dt>Open focused result</dt><dd><kbd>Enter</kbd></dd></div>
      <div><dt>Close a panel</dt><dd><kbd>Esc</kbd></dd></div>
    </dl>
  )
}

export function BrowserSetup() {
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const template = new URL('/search', window.location.origin).href + '?q=%s'
  return (
    <div className="settings">
      <p className="hint">Add a custom search engine in your browser’s settings. Use Pulpo Search for the name and paste this URL.</p>
      <div className="field-label">
        <label htmlFor="browser-search-url">Search URL</label>
        <div className="copy-field">
          <input id="browser-search-url" ref={input} readOnly value={template} onFocus={event => event.currentTarget.select()} />
          <button className="secondary-button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(template)
              setCopied(true)
            } catch {
              input.current?.select()
            }
          }}><Copy size={15} /> {copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
    </div>
  )
}
