import { useEffect, useRef } from 'react'
import { formulaReferences, type SheetView, type SheetViewState } from '@pulpo/client-core/office/sheets/view'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'

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

/** The name box and the formula bar above the grid, editing the same text as the cell editor. */
export function FormulaBar({ view, state }: { view: SheetView; state: SheetViewState }) {
  const nameBox = useRef<HTMLInputElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const text = state.editing?.text ?? state.activeInput
  const editable = !state.readOnly

  // The name box shows the selection unless someone is typing in it.
  useEffect(() => {
    const element = nameBox.current
    if (element && document.activeElement !== element) element.value = state.selectionLabel
  }, [state.selectionLabel])

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
    if (event.key === 'Enter' && !event.altKey) {
      event.preventDefault()
      if (view.commitEdit({ fill: event.ctrlKey || event.metaKey })) {
        if (!(event.ctrlKey || event.metaKey)) view.clipboard.moveWithin(event.shiftKey ? -1 : 1, 0)
        view.focus()
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      view.cancelEdit()
      input.current!.value = view.getState().activeInput
      view.focus()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      if (view.commitEdit()) {
        view.clipboard.moveWithin(0, event.shiftKey ? -1 : 1)
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
      <span aria-hidden className="grid w-8 shrink-0 place-items-center border-r border-border font-serif text-sm italic text-muted-foreground">fx</span>
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
