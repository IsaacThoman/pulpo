import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { NotebookSearch, NotebookSearchMatch } from '@pulpo/client-core/office/notebook/view'
import { ArrowDown, ArrowUp, CaseSensitive, Regex, Replace, WholeWord, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { activeLocale, ui } from '@/i18n/ui'
import { ToolbarButton } from '../../editor/ToolbarButton'

/** Opening the find bar: with Ctrl/Cmd+F (find) or the replace keys, seeded with the selected text. */
export interface NotebookFindRequest {
  mode: 'find' | 'replace'
  text: string
  /** Grows with every request, so pressing the keys again focuses the bar again. */
  nonce: number
}

function hasMod(event: KeyboardEvent): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey
}

/**
 * Find and replace across the notebook's cells, laid out like the Word editor's find bar: the
 * count of matches, previous and next, match case, whole words, regular expressions, and replace
 * one or all (each one undo step). Enter finds the next match and Shift+Enter the previous;
 * Escape closes it, leaving the current match selected in its cell.
 */
export function NotebookFindBar({ search, request, readOnly, onClose }: {
  search: NotebookSearch
  request: NotebookFindRequest
  readOnly: boolean
  /** Closed, with the match that was current (to select it), if any. */
  onClose: (match: NotebookSearchMatch | null) => void
}) {
  const [query, setQuery] = useState(request.text)
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regexp, setRegexp] = useState(false)
  const [showReplace, setShowReplace] = useState(request.mode === 'replace')
  const state = useSyncExternalStore(search.subscribe, search.getState)
  const findField = useRef<HTMLInputElement>(null)
  const replaceField = useRef<HTMLInputElement>(null)
  /** Ctrl+H pressed in the bar: the replace field takes the caret once it shows. */
  const toReplace = useRef(false)
  const locale = activeLocale()

  // Each request (the keys pressed again, from a cell or the cell list) takes the selected text and focuses the bar.
  useEffect(() => {
    if (request.text) setQuery(request.text)
    if (request.mode === 'replace') setShowReplace(true)
  }, [request])
  useEffect(() => {
    // Replace starts in the find field until there is something to find, as in VS Code.
    const replacing = toReplace.current || (request.mode === 'replace' && Boolean(request.text || findField.current?.value))
    toReplace.current = false
    const field = replacing && showReplace && !readOnly ? replaceField.current : findField.current
    field?.focus()
    field?.select()
  }, [request, showReplace, readOnly])
  useEffect(() => {
    search.setQuery({ text: query, matchCase, wholeWord, regexp })
  }, [search, query, matchCase, wholeWord, regexp])
  useEffect(() => () => search.clear(), [search])

  const close = () => onClose(search.getState().matches[search.getState().current] ?? null)
  const count = state.matches.length
  const status = !query ? '' : state.invalid ? ui("Invalid regular expression") : !count ? ui("No matches") : ui("{{index}} of {{count}}", {
    index: state.current >= 0 ? (state.current + 1).toLocaleString(locale) : '0',
    count: state.capped ? `${count.toLocaleString(locale)}+` : count.toLocaleString(locale),
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase()
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'F3' || (hasMod(event) && key === 'g')) {
      event.preventDefault()
      search.step(event.shiftKey ? -1 : 1)
    } else if (hasMod(event) && key === 'f' && !event.altKey) {
      // Not the browser's find: this bar's field.
      event.preventDefault()
      findField.current?.focus()
      findField.current?.select()
    } else if (hasMod(event) && ((key === 'h' && !event.altKey) || (event.altKey && event.code === 'KeyF'))) {
      event.preventDefault()
      if (readOnly) return
      if (replaceField.current) replaceField.current.focus()
      else {
        toReplace.current = true
        setShowReplace(true)
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-background px-3 py-1.5 sm:px-5" role="search" data-notebook-find onKeyDown={onKeyDown}>
      <Input
        ref={findField}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          search.step(event.shiftKey ? -1 : 1)
        }}
        placeholder={ui("Find in notebook")}
        aria-label={ui("Find in notebook")}
        aria-invalid={state.invalid || undefined}
        className="h-8 w-56"
        spellCheck={false}
      />
      <span className="min-w-16 text-xs text-muted-foreground tabular-nums" aria-live="polite" data-notebook-find-status>{status}</span>
      <ToolbarButton label={ui("Previous match")} shortcut={{ label: 'Shift+Enter', aria: 'Shift+Enter' }} disabled={!count} onClick={() => search.step(-1)}><ArrowUp className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Next match")} shortcut={{ label: 'Enter', aria: 'Enter' }} disabled={!count} onClick={() => search.step(1)}><ArrowDown className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Match case")} active={matchCase} onClick={() => setMatchCase((value) => !value)}><CaseSensitive className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Whole words")} active={wholeWord} onClick={() => setWholeWord((value) => !value)}><WholeWord className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Use regular expression")} active={regexp} onClick={() => setRegexp((value) => !value)}><Regex className="size-4" /></ToolbarButton>
      {!readOnly && <ToolbarButton label={ui("Toggle replace")} active={showReplace} onClick={() => setShowReplace((value) => !value)}><Replace className="size-4" /></ToolbarButton>}
      {showReplace && !readOnly && (
        <>
          <Input
            ref={replaceField}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (hasMod(event)) search.replaceAll(replacement)
              else search.replace(replacement)
            }}
            placeholder={ui("Replace with")}
            aria-label={ui("Replace with")}
            className="h-8 w-48"
            spellCheck={false}
          />
          <Button size="sm" variant="outline" disabled={!count} onMouseDown={(event) => event.preventDefault()} onClick={() => search.replace(replacement)}>{ui("Replace")}</Button>
          <Button size="sm" variant="outline" disabled={!count} onMouseDown={(event) => event.preventDefault()} onClick={() => search.replaceAll(replacement)}>{ui("Replace all")}</Button>
        </>
      )}
      <span className="ml-auto">
        <ToolbarButton label={ui("Close")} shortcut={{ label: 'Esc', aria: 'Escape' }} onClick={close}><X className="size-4" /></ToolbarButton>
      </span>
    </div>
  )
}
