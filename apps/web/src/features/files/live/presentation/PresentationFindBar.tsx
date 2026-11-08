import { useEffect, useMemo, useRef, useState } from 'react'
import type { FindMatch, PresentationController } from '@pulpo/client-core/office/presentation/view'
import { ArrowDown, ArrowUp, CaseSensitive, Replace, WholeWord, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToolbarButton } from '@/features/files/editor/ToolbarButton'
import { ui } from '@/i18n/ui'
import { firstMatchFrom, nextAfterReplace } from './find'

/**
 * Find and replace across the deck, as the Word editor's bar has it: matches on the slides and in
 * the speaker notes, "n of m", previous and next (Enter, Shift+Enter), match case, whole words, and
 * replace or replace all. Each match is shown on its slide while typing stays in the bar; Escape
 * closes it and goes back to the text of the match shown.
 */
export function PresentationFindBar({ controller, replace, focusRequest, onReveal, onClose }: {
  controller: PresentationController
  /** Show the replace field (Cmd/Ctrl+H, Find and replace). */
  replace: boolean
  /** Changes when the host asks again (Cmd/Ctrl+F with the bar open): the search field takes focus. */
  focusRequest?: number
  /** A match is about to show (the host opens the speaker notes or the editor view for it). */
  onReveal?: (match: FindMatch) => void
  /** Escape or Close; with the match last shown, whose text focus goes back to. */
  onClose: (shown?: FindMatch) => void
}) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [showReplace, setShowReplace] = useState(replace)
  const [index, setIndex] = useState(0)
  const [replaced, setReplaced] = useState<number | null>(null)
  // Edits (here, by collaborators, or by replacing) search again; selection changes do not.
  const [contentVersion, setContentVersion] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const revealNext = useRef(false)
  /** The match Replace just replaced, and where its replacement ends. */
  const replacedAt = useRef<{ match: FindMatch; end: number } | undefined>(undefined)
  const shown = useRef<FindMatch | undefined>(undefined)
  useEffect(() => controller.subscribe((change) => {
    if (change.slides.size || change.order || change.parts) setContentVersion((version) => version + 1)
  }), [controller])
  useEffect(() => { if (replace) setShowReplace(true) }, [replace, focusRequest])
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusRequest])

  const matches = useMemo(() => {
    void contentVersion
    return query ? controller.find(query, { matchCase, wholeWord }) : []
  }, [controller, query, matchCase, wholeWord, contentVersion])
  const current = matches.length ? Math.min(index, matches.length - 1) : -1

  const reveal = (list: readonly FindMatch[], at: number) => {
    const match = list[at]
    if (!match) return
    shown.current = match
    onReveal?.(match)
    controller.revealMatch(match)
  }
  const close = () => onClose(shown.current)

  // A new search goes to its first match from the current slide on; edits keep the place.
  useEffect(() => {
    setReplaced(null)
    if (!matches.length) return
    const start = firstMatchFrom(matches, controller.slideKeys(), controller.state.slide)
    setIndex(start)
    reveal(matches, start)
    // Only a new query or option moves to a match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase, wholeWord])

  // After Replace, the next match takes the replaced one's place in the list (past any match in
  // the replacement itself): show it.
  useEffect(() => {
    if (!revealNext.current) return
    revealNext.current = false
    const replaced = replacedAt.current
    replacedAt.current = undefined
    if (!matches.length) return
    const next = replaced ? nextAfterReplace(matches, index, replaced.match, replaced.end) : current
    if (next !== index) setIndex(next)
    reveal(matches, next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])

  const step = (delta: 1 | -1) => {
    if (!matches.length) return
    const next = (Math.max(0, current) + delta + matches.length) % matches.length
    setIndex(next)
    reveal(matches, next)
  }

  const replaceOne = () => {
    const match = matches[current]
    if (!match) return
    revealNext.current = true
    replacedAt.current = { match, end: match.from + replacement.length }
    if (!controller.replaceMatch(match, replacement)) {
      // The text changed since the search: search again and show the match now there.
      replacedAt.current = undefined
      setContentVersion((version) => version + 1)
    }
  }

  const replaceAll = () => {
    const count = controller.replaceAll(query, replacement, { matchCase, wholeWord })
    setReplaced(count)
  }

  const editable = !controller.readOnly
  const noMatches = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50'
  const status = query ? (replaced !== null ? ui("Replaced {{count}}", { count: replaced }) : ui("{{index}} of {{count}}", { index: current + 1, count: matches.length })) : ''
  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b bg-background px-3 py-1.5"
      role="search"
      aria-label={ui("Find and replace")}
      data-presentation-find=""
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
    >
      <Input
        ref={input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
          }
        }}
        placeholder={ui("Find in presentation")}
        aria-label={ui("Find in presentation")}
        className="h-8 w-48 min-w-0 flex-1 sm:flex-none"
      />
      <span className="min-w-14 text-xs text-muted-foreground tabular-nums" aria-live="polite" data-find-status="">{status}</span>
      <ToolbarButton label={ui("Previous match")} disabled={!matches.length} onClick={() => step(-1)}><ArrowUp className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Next match")} disabled={!matches.length} onClick={() => step(1)}><ArrowDown className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Match case")} active={matchCase} onClick={() => setMatchCase((value) => !value)}><CaseSensitive className="size-4" /></ToolbarButton>
      <ToolbarButton label={ui("Whole words")} active={wholeWord} onClick={() => setWholeWord((value) => !value)}><WholeWord className="size-4" /></ToolbarButton>
      {editable && <ToolbarButton label={ui("Replace")} active={showReplace} onClick={() => setShowReplace((value) => !value)}><Replace className="size-4" /></ToolbarButton>}
      {editable && showReplace && (
        <>
          <Input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                replaceOne()
              }
            }}
            placeholder={ui("Replace with")}
            aria-label={ui("Replace with")}
            className="h-8 w-44 min-w-0 flex-1 sm:flex-none"
          />
          {/* aria-disabled, not disabled: a focused button that turns disabled once the last match goes would drop focus out of the bar. */}
          <Button size="sm" variant="outline" aria-disabled={!matches.length} className={noMatches} onClick={() => { if (matches.length) replaceOne() }}>{ui("Replace")}</Button>
          <Button size="sm" variant="outline" aria-disabled={!matches.length} className={noMatches} onClick={() => { if (matches.length) replaceAll() }}>{ui("Replace all")}</Button>
        </>
      )}
      <span className="ml-auto" />
      <ToolbarButton label={ui("Close")} onClick={close}><X className="size-4" /></ToolbarButton>
    </div>
  )
}
