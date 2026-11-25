import { Search, X } from 'lucide-react'
import { useId, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { searchBangs, type CustomBang } from './bangs'
import { MAX_QUERY_LENGTH } from './navigation'

interface SearchBoxProps {
  value: string
  setValue: (value: string) => void
  onSearch: (query: string) => void
  customBangs: CustomBang[]
  input: RefObject<HTMLInputElement | null>
}

export function SearchBox({ value, setValue, onSearch, customBangs, input }: SearchBoxProps) {
  const inputId = useId()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const bangPrefix = /^!([\w-]*)$/.exec(value.trimStart())
  const matches = open && bangPrefix ? searchBangs(bangPrefix[1], customBangs).slice(0, 6) : []

  function choose(bang: CustomBang) {
    setValue('!' + bang.trigger + ' ')
    setActive(-1)
    setOpen(false)
    input.current?.focus()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (matches[active]) {
      choose(matches[active])
      return
    }
    setOpen(false)
    onSearch(value)
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
      return
    }
    if (matches.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(index => (index + 1) % matches.length)
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(index => index <= 0 ? matches.length - 1 : index - 1)
    }
  }

  return (
    <form className="search-box" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor={inputId}>Search the web</label>
      <Search className="search-leading" size={21} aria-hidden="true" />
      <input
        id={inputId}
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-controls={matches.length ? listId : undefined}
        aria-activedescendant={matches[active] ? listId + '-' + active : undefined}
        type="text"
        name="q"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_QUERY_LENGTH}
        placeholder="Search the web"
        value={value}
        onChange={event => { setValue(event.target.value); setActive(-1); setOpen(true) }}
        onKeyDown={handleKey}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1) }}
      />
      {value && (
        <button className="icon-button search-clear" type="button" aria-label="Clear query" onClick={() => {
          setValue('')
          input.current?.focus()
        }}>
          <X size={17} aria-hidden="true" />
        </button>
      )}
      <button className="search-submit" type="submit" aria-label="Search">
        Search
      </button>
      {matches.length > 0 && (
        <ul className="bang-suggestions" id={listId} role="listbox" aria-label="Bangs">
          {matches.map((bang, index) => (
            <li
              id={listId + '-' + index}
              role="option"
              key={bang.trigger}
              aria-selected={index === active}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(bang)}
            >
              <code>!{bang.trigger}</code>
              {bang.name}
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
