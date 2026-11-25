import { History, Search, X } from 'lucide-react'
import { useId, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { suggestBangs, type CustomBang } from './bangs'
import { MAX_QUERY_LENGTH } from './navigation'
import { queryTokens } from './query-tokens'
import { matchRecentQueries } from './recent-queries'

interface SearchBoxProps {
  value: string
  setValue: (value: string) => void
  onSearch: (query: string) => void
  customBangs: CustomBang[]
  recentQueries?: readonly string[]
  input: RefObject<HTMLInputElement | null>
}

type Suggestion = { trigger: string; label: string } | { label: string }
const noRecentQueries: readonly string[] = []

export function SearchBox({ value, setValue, onSearch, customBangs, recentQueries = noRecentQueries, input }: SearchBoxProps) {
  const inputId = useId()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string>()
  const lastToken = queryTokens(value).at(-1)
  const bangPrefix = lastToken?.end === value.length && lastToken.text.startsWith('!')
    ? /^\s*!([\w-]*)$/.exec(value) ?? /\s!([\w-]+)$/.exec(value) : null
  const candidates: Suggestion[] = bangPrefix
    ? suggestBangs(bangPrefix[1], customBangs).slice(0, 6).map(bang => ({ trigger: bang.trigger, label: bang.name }))
    : matchRecentQueries(recentQueries, value).map(query => ({ label: query }))
  const matches = open ? candidates : []

  function keyOf(suggestion: Suggestion) {
    return 'trigger' in suggestion ? 'bang:' + suggestion.trigger : 'recent:' + suggestion.label
  }

  const selected = matches.findIndex(suggestion => keyOf(suggestion) === active)

  function choose(suggestion: Suggestion) {
    setActive(undefined)
    setOpen(false)
    if ('trigger' in suggestion) {
      setValue(value.slice(0, value.lastIndexOf('!') + 1) + suggestion.trigger + ' ')
      input.current?.focus()
    } else {
      setValue(suggestion.label)
      onSearch(suggestion.label)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (matches[selected]) {
      choose(matches[selected])
      return
    }
    setOpen(false)
    setActive(undefined)
    onSearch(value)
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      if (matches.length) event.preventDefault()
      setOpen(false)
      setActive(undefined)
      return
    }
    if (candidates.length === 0 || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    event.preventDefault()
    setOpen(true)
    if (event.key === 'ArrowDown') {
      setActive(keyOf(candidates[(selected + 1) % candidates.length]))
    } else {
      setActive(keyOf(candidates[selected <= 0 ? candidates.length - 1 : selected - 1]))
    }
  }

  return (
    <form className="search-box" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor={inputId}>Search the web</label>
      <button className="icon-button search-submit" type="submit" aria-label="Search" title="Search">
        <Search size={19} aria-hidden="true" />
      </button>
      <input
        id={inputId}
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-controls={matches.length ? listId : undefined}
        aria-activedescendant={selected >= 0 ? listId + '-' + selected : undefined}
        type="text"
        name="q"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_QUERY_LENGTH}
        placeholder="Search the web"
        value={value}
        onChange={event => { setValue(event.target.value); setActive(undefined); setOpen(true) }}
        onKeyDown={handleKey}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(undefined) }}
      />
      {value && (
        <button className="icon-button search-clear" type="button" aria-label="Clear query" onClick={() => {
          setValue('')
          setActive(undefined)
          setOpen(true)
          input.current?.focus()
        }}>
          <X size={17} aria-hidden="true" />
        </button>
      )}
      {matches.length > 0 && (
        <ul className="bang-suggestions" id={listId} role="listbox" aria-label={bangPrefix ? 'Bangs' : 'Recent searches'}>
          {matches.map((suggestion, index) => (
            <li
              id={listId + '-' + index}
              role="option"
              key={keyOf(suggestion)}
              aria-selected={index === selected}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(suggestion)}
            >
              {'trigger' in suggestion ? (
                <><code>!{suggestion.trigger}</code>{suggestion.label}</>
              ) : (
                <><History size={16} className="recent-suggestion-icon" aria-hidden="true" /><span className="recent-suggestion-text">{suggestion.label}</span></>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
