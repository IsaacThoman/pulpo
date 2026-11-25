import { Copy, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { providerNames, type Provider, type SearchConfig } from './api'
import { searchBangs, validateCustomBang, type CustomBang } from './bangs'
import { providerOrder, type Preferences } from './preferences'

export type Panel = 'settings' | 'bangs' | 'shortcuts' | 'browser'

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    return () => element.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="dialog"
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
}

function formatPrice(micros: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(micros / 1_000_000)
}

export function Settings({ config, preferences, update }: SettingsProps) {
  const activePrimary = config ? providerOrder(preferences, config)[0] : undefined
  const domainEntries = Object.entries(preferences.domains).sort(([a], [b]) => a.localeCompare(b))
  const available = config?.providers.map(provider => provider.id) ?? []
  const primaryLabel = config?.defaultOrder[0]
  const searchPrice = config?.providers.find(provider => provider.id === activePrimary)?.priceMicros ?? 0
  return (
    <div className="settings">
      <p className="hint">Changes apply to this browser.</p>
      <fieldset className="settings-group">
        <legend>Search providers</legend>
        {available.length > 0 ? (
          <>
            <div className="settings-row">
              <label htmlFor="search-provider-default">Default</label>
              <select id="search-provider-default" value={available.includes(preferences.defaultProvider as Provider) ? preferences.defaultProvider : ''}
                onChange={event => update({ ...preferences, defaultProvider: event.target.value as Preferences['defaultProvider'] })}>
                <option value="">Pulpo default{primaryLabel ? ' · ' + providerNames[primaryLabel] : ''}</option>
                {available.map(provider => <option key={provider} value={provider}>{providerNames[provider]}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label htmlFor="search-provider-fallback">Fallback</label>
              <select id="search-provider-fallback" value={preferences.fallbackProvider === 'none' || available.some(
                provider => provider === preferences.fallbackProvider && provider !== activePrimary,
              ) ? preferences.fallbackProvider : ''}
                onChange={event => update({ ...preferences, fallbackProvider: event.target.value as Preferences['fallbackProvider'] })}>
                <option value="">Automatic</option>
                {available.filter(provider => provider !== activePrimary).map(provider => (
                  <option key={provider} value={provider}>{providerNames[provider]}</option>
                ))}
                <option value="none">Off</option>
              </select>
            </div>
            <p className="hint">Provider changes apply to your next search. Pulpo can try your fallback when the default can’t complete it.</p>
            {searchPrice > 0 && <p className="hint">The default provider costs {formatPrice(searchPrice)} per search from your shared Pulpo credits.</p>}
          </>
        ) : <p className="hint">Provider options appear when you’re signed in and search is available.</p>}
      </fieldset>
      <fieldset className="settings-group">
        <legend>Appearance and results</legend>
        <div className="settings-row">
          <label htmlFor="search-theme">Theme</label>
          <select id="search-theme" value={preferences.theme} onChange={event => update({ ...preferences, theme: event.target.value as Preferences['theme'] })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="search-limit">Results per search</label>
          <select id="search-limit" value={preferences.limit} onChange={event => update({ ...preferences, limit: event.target.value === '20' ? 20 : 10 })}>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
        </div>
        <label className="settings-row">
          Open links in a new tab
          <input type="checkbox" checked={preferences.newTab} onChange={event => update({ ...preferences, newTab: event.target.checked })} />
        </label>
      </fieldset>
      <fieldset className="settings-group">
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
      <p className="hint">Type a shortcut before your query to search on another site. Try <code>!w tide pools</code>.</p>
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

export function Shortcuts() {
  return (
    <dl className="shortcut-list">
      <div><dt>Focus search</dt><dd><kbd>/</kbd></dd></div>
      <div><dt>Next result</dt><dd><kbd>J</kbd></dd></div>
      <div><dt>Previous result</dt><dd><kbd>K</kbd></dd></div>
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
