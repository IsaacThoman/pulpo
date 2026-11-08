import { useEffect, useRef, type RefObject } from 'react'
import { formulaReferences, type SheetView, type SheetViewState } from '@pulpo/client-core/office/sheets/view'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { focusIsIdle } from './dialog-focus'
import { FunctionMenuItems } from './FunctionMenu'
import { canInsertFunction } from './functions'

/** Splits formula text into plain and reference pieces, colored like the grid highlights. */
function highlighted(text: string): { text: string; color?: string }[] {
  const references = formulaReferences(text)
  const pieces: { text: string; color?: string }[] = []
  let cursor = 0
  for (const reference of references) {
    if (reference.start > cursor) pieces.push({ text: text.slice(cursor, reference.start) })
    pieces.push({ text: text.slice(reference.start, reference.end), color: reference.color })
    cursor = reference.end
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor) })
  return pieces
}

/**
 * The name box and the formula bar above the grid, editing the same text as the cell editor. Its
 * fx button lists functions to insert, as Excel's Insert Function and Google's Σ menu do.
 */
export function FormulaBar({ view, state, nameBoxRef }: {
  view: SheetView
  state: SheetViewState
  /** The name box, for Ctrl+G (Go to). */
  nameBoxRef?: RefObject<HTMLInputElement | null>
}) {
  const ownNameBox = useRef<HTMLInputElement>(null)
  const nameBox = nameBoxRef ?? ownNameBox
  const input = useRef<HTMLTextAreaElement>(null)
  const text = state.editing?.text ?? state.activeInput
  const editable = !state.readOnly

  // The name box shows the selection unless someone is typing in it.
  useEffect(() => {
    const element = nameBox.current
    if (element && document.activeElement !== element) element.value = state.selectionLabel
  }, [nameBox, state.selectionLabel])

  // While the cell editor types, the bar follows; while the bar types, the grid follows.
  useEffect(() => {
    const element = input.current
    if (!element || document.activeElement === element) return
    if (element.value !== text) element.value = text
  }, [text])

  const onChange = () => {
    const element = input.current!
    if (!view.editing) view.beginEdit(element.value, false)
    else view.setEditText(element.value, element.selectionStart)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    // Enter and Tab ask about a value a warning or information rule flags, as the grid's do; an
    // answer given later moves on (and focuses the grid) itself.
    if (event.key === 'Enter' && !event.altKey) {
      event.preventDefault()
      const fill = event.ctrlKey || event.metaKey
      const then = () => { if (!fill) view.clipboard.moveWithin(event.shiftKey ? -1 : 1, 0) }
      if (view.commitEdit({ fill, ask: true, then })) {
        then()
        view.focus()
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      view.cancelEdit()
      input.current!.value = view.getState().activeInput
      view.focus()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const then = () => view.clipboard.moveWithin(0, event.shiftKey ? -1 : 1)
      if (view.commitEdit({ ask: true, then })) {
        then()
        view.focus()
      }
    }
  }

  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-background text-sm">
      <input
        ref={nameBox}
        aria-label={ui("Name box")}
        defaultValue={state.selectionLabel}
        onFocus={(event) => event.target.select()}
        onBlur={(event) => {
          event.target.value = view.getState().selectionLabel
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (view.goTo(event.currentTarget.value)) view.focus()
          } else if (event.key === 'Escape') view.focus()
        }}
        className="w-28 shrink-0 border-r border-border bg-transparent px-2 font-mono text-xs outline-none focus:bg-accent/40"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!canInsertFunction(view)}>
          <button
            type="button"
            aria-label={ui("Insert function")}
            title={ui("Insert function")}
            disabled={!canInsertFunction(view)}
            // Keeps the cell (or this bar's) edit focused, so a function goes in at the caret.
            onMouseDown={(event) => event.preventDefault()}
            className="grid w-8 shrink-0 cursor-pointer place-items-center border-r border-border font-serif text-sm italic text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <span aria-hidden>{ui("fx")}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-44"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            // It closes after its animation: by then a menu opened next may hold the focus.
            if (focusIsIdle()) view.focus()
          }}
        >
          <FunctionMenuItems view={view} />
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="relative min-w-0 flex-1">
        {/* Colored references under a transparent textarea, so typing and selection stay native. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-2 py-1.5 font-mono text-xs leading-5">
          {text.startsWith('=')
            ? highlighted(text).map((piece, index) => (
                <span key={index} style={piece.color ? { color: piece.color } : undefined}>
                  {piece.text}
                </span>
              ))
            : text}
        </div>
        <textarea
          ref={input}
          aria-label={ui("Formula bar")}
          defaultValue={text}
          readOnly={!editable}
          rows={1}
          spellCheck={false}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onSelect={() => {
            const element = input.current!
            if (view.editing) view.setEditText(element.value, element.selectionStart)
          }}
          className={cn(
            'absolute inset-0 resize-none overflow-hidden whitespace-pre bg-transparent px-2 py-1.5 font-mono text-xs leading-5 text-transparent caret-foreground outline-none selection:bg-primary/25',
            !editable && 'cursor-default',
          )}
        />
      </div>
    </div>
  )
}
