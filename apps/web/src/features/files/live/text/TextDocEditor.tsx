import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { textFileFacts, TEXT_FILE_FIELD } from '@pulpo/client-core/office/text'
import { createTextEditor, type TextEditor, type TextEditorIndent, type TextEditorState } from '@pulpo/client-core/office/text/view'
import { Check, ChevronDown, Eye, Redo2, Search, Undo2, WrapText } from 'lucide-react'
import * as Y from 'yjs'
import { SandboxFrame } from '@/components/chat/SandboxFrame'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useFileToasts } from '../../browser/toasts'
import { sessionColor, sessionLabel } from '../../editor/presence'
import { ToolbarButton } from '../../editor/ToolbarButton'
import { EditorMenuBar } from '../chrome/EditorMenuBar'
import { fileEditorRoot } from '../chrome/editor-root'
import { fileMenuDefinition } from '../chrome/file-menu'
import { shortcutGroupsFromMenus, type MenuDefinition } from '../chrome/menu'
import { printHtmlDocument, textPrintHtml } from '../chrome/output'
import { formatShortcut, matchesShortcut, type ShortcutSpec } from '../chrome/shortcuts'
import { ShortcutsDialog } from '../chrome/ShortcutsDialog'
import { helpMenu } from '../chrome/standard-menus'
import { useEditorShortcuts } from '../chrome/use-editor-shortcuts'
import { zoomPercent } from '../chrome/zoom'
import { useStoredFlag, useStoredNumber } from '../stored-preference'
import type { LiveEditorProps } from '../types'
import { isProseFile } from './prose'
import { COPY_SHORTCUT, CUT_SHORTCUT, MAX_TEXT_ZOOM, MIN_TEXT_ZOOM, PASTE_SHORTCUT, textMenus, WRAP_SHORTCUT } from './text-menus'
import { textShortcutGroups } from './text-shortcuts'
import { TextStatusCounts } from './TextCounts'

/** Waits this long after the last keystroke before rendering the HTML preview again. */
const PREVIEW_DELAY_MS = 400
const WRAP_KEY = 'pulpo:text-editor:wrap'
const LINE_NUMBERS_KEY = 'pulpo:text-editor:line-numbers'
const ZOOM_KEY = 'pulpo:text-editor:zoom'
/** The editor's font size at 100% (client-core's editor theme). */
const BASE_FONT_PX = 13

/** The wrap preference; storage can be unavailable (private windows, blocked site data). */
function storedWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) === 'true'
  } catch {
    return false
  }
}

function storeWrap(wrap: boolean): void {
  try {
    localStorage.setItem(WRAP_KEY, String(wrap))
  } catch {
    // The choice still applies to this editor.
  }
}

/**
 * Alt+Z (VS Code's Toggle Word Wrap). Off a Mac, Alt with a letter types nothing, so the physical
 * key counts where the layout's letter is not Latin (Alt+Я in Russian); AltGr, which types, comes
 * with Ctrl or as AltGraph. On a Mac, Option types letters (ż on Polish Pro, ž on Latvian, ¥ on
 * German), so only the Ω that Option+Z types on US, ABC, and German layouts counts (as Greek
 * omega or the ohm sign); other layouts wrap lines from the toolbar or the View menu.
 */
function isWrapKey(event: React.KeyboardEvent, mac: boolean): boolean {
  if (event.getModifierState('AltGraph')) return false
  if (!mac) return matchesShortcut(event, WRAP_SHORTCUT)
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key.toLowerCase() === 'z' || event.key === '\u03A9' || event.key === '\u2126')
}

/** Find, replace, and go to line, pressed while focus is on the toolbar or status bar rather than in the text. */
function findCommand(event: React.KeyboardEvent, mac: boolean): 'find' | 'replace' | 'line' | null {
  const key = event.key.toLowerCase()
  const mod = mac ? event.metaKey : event.ctrlKey
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === 'g') return 'line'
  if (!mod) return null
  if (mac ? (event.altKey && event.code === 'KeyF') || (event.shiftKey && key === 'h') : !event.altKey && !event.shiftKey && key === 'h') return 'replace'
  return !event.altKey && !event.shiftKey && key === 'f' ? 'find' : null
}

/** Whether the app is showing its dark theme; it toggles a class on the root element. */
function useDarkTheme(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const observer = new MutationObserver(listener)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      return () => observer.disconnect()
    },
    () => document.documentElement.classList.contains('dark'),
  )
}

/** The phrases CodeMirror shows (search panel, folding), in the app's language. */
function editorLabels(): Record<string, string> {
  return {
    Editor: ui("Text editor"),
    Find: ui("Find"),
    Replace: ui("Replace"),
    next: ui("next"),
    previous: ui("previous"),
    all: ui("all"),
    'match case': ui("match case"),
    regexp: ui("regexp"),
    'by word': ui("by word"),
    replace: ui("replace"),
    'replace all': ui("replace all"),
    close: ui("close"),
    'Go to line': ui("Go to line"),
    go: ui("go"),
    'current match': ui("current match"),
    'on line': ui("on line"),
    'replaced match on line $': ui("replaced match on line $"),
    'replaced $ matches': ui("replaced $ matches"),
    'Folded lines': ui("Folded lines"),
    'Unfolded lines': ui("Unfolded lines"),
    to: ui("to"),
    'folded code': ui("folded code"),
    unfold: ui("unfold"),
    'Fold line': ui("Fold line"),
    'Unfold line': ui("Unfold line"),
    'Control character': ui("Control character"),
  }
}

const ENCODING_LABELS: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 BOM',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows-1252',
}

/** The file's encoding and line breaks, as the codec keeps them beside the text. */
function useFileFacts(doc: Y.Doc) {
  const [facts, setFacts] = useState(() => textFileFacts(doc))
  useEffect(() => {
    const map = doc.getMap(TEXT_FILE_FIELD)
    const update = () => setFacts(textFileFacts(doc))
    map.observe(update)
    update()
    return () => map.unobserve(update)
  }, [doc])
  return facts
}

/** The HTML being edited, rendered in the opaque-origin sandbox and refreshed as it changes. */
function HtmlPreview({ doc, name }: { doc: Y.Doc; name: string }) {
  const [code, setCode] = useState(() => doc.getText('text').toString())
  useEffect(() => {
    const text = doc.getText('text')
    let timer: number | undefined
    const update = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setCode(text.toString()), PREVIEW_DELAY_MS)
    }
    text.observe(update)
    return () => {
      window.clearTimeout(timer)
      text.unobserve(update)
    }
  }, [doc])
  // Each frame renders once; a new key makes a new frame for the new content.
  return <SandboxFrame key={code} kind="html" code={code} title={uit`Preview of ${name}`} />
}

function IndentMenu({ indent, disabled, onChange, onClosed }: { indent: TextEditorIndent; disabled: boolean; onChange: (indent: TextEditorIndent) => void; onClosed: () => void }) {
  const option = (next: TextEditorIndent, label: string) => (
    <DropdownMenuItem key={label} onSelect={() => onChange(next)}>
      <Check className={cn('size-4', !(next.tabs === indent.tabs && next.size === indent.size) && 'invisible')} />
      {label}
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ui("Indentation")}
          className="flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {indent.tabs ? uit`Tabs: ${indent.size}` : uit`Spaces: ${indent.size}`}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          // Typing goes on in the text, not on the menu's button.
          event.preventDefault()
          onClosed()
        }}
      >
        <DropdownMenuLabel>{ui("Indent with spaces")}</DropdownMenuLabel>
        {[2, 4, 8].map((size) => option({ size, tabs: false }, uit`${size} spaces`))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{ui("Indent with tabs")}</DropdownMenuLabel>
        {[2, 4, 8].map((size) => option({ size, tabs: true }, uit`Tab width ${size}`))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Text and code files, edited collaboratively in CodeMirror (the shared view core in
 * `@pulpo/client-core/office/text/view`), with an HTML preview for web pages.
 */
export function TextDocEditor({ session, name, editable, width, toolbarSlot, fileMenu, onSaveShortcut }: LiveEditorProps) {
  const shell = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<TextEditor | null>(null)
  const [state, setState] = useState<TextEditorState | null>(null)
  const [preview, setPreview] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [wordCountOpen, setWordCountOpen] = useState(false)
  const [lineNumbers, setLineNumbers] = useStoredFlag(LINE_NUMBERS_KEY, true)
  const [zoom, setZoom] = useStoredNumber(ZOOM_KEY, 1, MIN_TEXT_ZOOM, MAX_TEXT_ZOOM)
  // Prose (notes, READMEs) is spell checked, as in Docs; code is not, as in VS Code. View ▸ Spell check overrides it.
  const [spellcheckChoice, setSpellcheck] = useState<boolean | null>(null)
  const spellcheck = spellcheckChoice ?? isProseFile(name)
  const dark = useDarkTheme()
  const facts = useFileFacts(session.doc)
  const html = /\.html?$/i.test(name)
  const latest = useRef({ name, editable, dark, lineNumbers, spellcheck })
  latest.current = { name, editable, dark, lineNumbers, spellcheck }

  useEffect(() => {
    const { name: initialName, editable: initialEditable, dark: initialDark, lineNumbers: initialLineNumbers, spellcheck: initialSpellcheck } = latest.current
    const created = createTextEditor({
      container: container.current!,
      doc: session.doc,
      awareness: session.provider.awareness,
      readOnly: !initialEditable,
      user: { name: sessionLabel(), color: sessionColor(session.doc.clientID) },
      name: initialName,
      labels: editorLabels(),
      dark: initialDark,
      wrap: storedWrap(),
      lineNumbers: initialLineNumbers,
      spellcheck: initialSpellcheck,
      onChange: setState,
    })
    editor.current = created
    setState(created.state())
    return () => {
      created.destroy()
      editor.current = null
    }
  }, [session])

  useEffect(() => { editor.current?.setReadOnly(!editable) }, [editable])
  useEffect(() => {
    // An opened file takes the keyboard once it can be edited (so Ctrl+F finds in it), unless
    // something else has it; the side panel never takes it from the chat.
    if (editable && width !== 'fill' && (!document.activeElement || document.activeElement === document.body)) editor.current?.focus()
  }, [editable, width, session])
  useEffect(() => { editor.current?.setDark(dark) }, [dark])
  useEffect(() => { editor.current?.setName(name) }, [name])
  useEffect(() => { editor.current?.setLineNumbers(lineNumbers) }, [lineNumbers])
  useEffect(() => { editor.current?.setSpellcheck(spellcheck) }, [spellcheck])
  // The font size follows the zoom through a CSS variable; CodeMirror then measures its lines again.
  useEffect(() => { editor.current?.view.requestMeasure() }, [zoom])

  const run = (action: (target: TextEditor) => void, options: { focus?: boolean } = {}) => () => {
    if (!editor.current) return
    action(editor.current)
    // Find and go to line put the caret in their own field.
    if (options.focus !== false) editor.current.focus()
  }
  const button = (label: string, icon: ReactNode, onClick: () => void, options: { active?: boolean; disabled?: boolean; shortcut?: { label: string; aria: string } } = {}) => (
    <ToolbarButton label={label} onClick={onClick} active={options.active} disabled={options.disabled} shortcut={options.shortcut}>{icon}</ToolbarButton>
  )
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  const shortcut = (key: string) => ({ label: mac ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`, aria: `${mac ? 'Meta' : 'Control'}+${key}` })
  const toggleWrap = (target: TextEditor) => {
    const next = !target.state().wrap
    storeWrap(next)
    target.setWrap(next)
  }
  const print = () => printHtmlDocument(textPrintHtml(name, session.doc.getText('text').toString()))
  // The search panel takes focus itself, ready to type in; focusing the text after would take it back.
  const openSearch = () => editor.current?.openSearch()

  useEditorShortcuts(shell, {
    print,
    save: onSaveShortcut,
    shortcuts: () => setShortcutsOpen(true),
    find: openSearch,
    replace: () => editor.current?.openReplace(),
    focus: () => editor.current?.focus(),
  })

  /** When the browser keeps the menu from the clipboard (Firefox, or permission denied), its keys still work. */
  const clipboardBlocked = (keys: ShortcutSpec) => () => {
    useFileToasts.getState().show({ message: ui("Your browser kept the menu from using the clipboard. Press {{keys}} instead.", { keys: formatShortcut(keys) }), tone: 'error' })
  }
  const copy = () => {
    const text = editor.current?.selectionText()
    if (!text) return
    const write = navigator.clipboard?.writeText(text)
    if (!write) return clipboardBlocked(COPY_SHORTCUT)()
    void write.catch(clipboardBlocked(COPY_SHORTCUT))
  }
  const cut = () => {
    const target = editor.current
    const text = target?.selectionText()
    if (!target || !text) return
    const write = navigator.clipboard?.writeText(text)
    if (!write) return clipboardBlocked(CUT_SHORTCUT)()
    void write.then(() => {
      // Only once it is on the clipboard, and only what was copied: the selection may have changed since.
      if (target.selectionText() === text) target.replaceSelection('', 'delete.cut')
    }, clipboardBlocked(CUT_SHORTCUT))
  }
  const paste = () => {
    const target = editor.current
    const read = navigator.clipboard?.readText?.()
    if (!target || !read) return clipboardBlocked(PASTE_SHORTCUT)()
    void read.then((text) => { if (text) target.replaceSelection(text, 'input.paste') }, clipboardBlocked(PASTE_SHORTCUT))
  }

  const menus: MenuDefinition[] = [
    fileMenuDefinition(fileMenu, () => ({ print })),
    ...(editor.current ? textMenus({
      editor: editor.current,
      editable,
      cut,
      copy,
      paste,
      find: openSearch,
      replace: () => editor.current?.openReplace(),
      toggleWrap: run(toggleWrap),
      lineNumbers,
      setLineNumbers,
      spellcheck,
      setSpellcheck,
      zoom,
      setZoom,
      preview: html ? { on: preview, toggle: () => setPreview(!preview) } : undefined,
      wordCount: () => setWordCountOpen(true),
    }) : []),
    // Cmd/Ctrl+/ comments lines out here, as in VS Code; it opens the list only in plain text.
    helpMenu(() => setShortcutsOpen(true), { key: false }),
  ]

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!editor.current || event.defaultPrevented) return
    // Menus and dialogs (portaled, but their keys bubble here through React) keep their keys.
    if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) return
    // Alt+Z wraps lines, in the text too (CodeMirror binds no Alt+Z); the search and go-to-line fields keep it.
    if (isWrapKey(event, mac) && !(event.target instanceof Element && event.target.closest('.cm-panels'))) {
      event.preventDefault()
      toggleWrap(editor.current)
      return
    }
    // Inside the text, CodeMirror's own keymap has these.
    if (event.target instanceof Node && editor.current.view.dom.contains(event.target)) return
    const command = findCommand(event, mac)
    if (!command) return
    event.preventDefault()
    if (command === 'find') editor.current.openSearch()
    else if (command === 'replace') editor.current.openReplace()
    else editor.current.openGotoLine()
  }

  return (
    <div ref={shell} className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown} {...fileEditorRoot('text')}>
      <EditorMenuBar menus={menus} onClose={() => editor.current?.focus()} className="px-3 pt-0.5 sm:px-5" />
      <div className="flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-1.5 sm:px-6">
        <div role="toolbar" aria-label={ui("Editing")} className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          {button(ui("Undo"), <Undo2 className="size-4" />, run((target) => target.undo()), { disabled: !editable || !state?.canUndo, shortcut: shortcut('z') })}
          {button(ui("Redo"), <Redo2 className="size-4" />, run((target) => target.redo()), { disabled: !editable || !state?.canRedo })}
          <span className="mx-1 h-5 w-px bg-border" />
          {button(ui("Find and replace"), <Search className="size-4" />, openSearch, { shortcut: shortcut('f') })}
          {button(ui("Wrap lines"), <WrapText className="size-4" />, run(toggleWrap), { active: state?.wrap ?? false, shortcut: { label: formatShortcut(WRAP_SHORTCUT), aria: 'Alt+z' } })}
          {state && <IndentMenu indent={state.indent} disabled={!editable} onChange={(indent) => editor.current?.setIndent(indent)} onClosed={() => editor.current?.focus()} />}
          {html && (
            <>
              <span className="mx-1 h-5 w-px bg-border" />
              {button(ui("Preview"), <Eye className="size-4" />, () => setPreview(!preview), { active: preview })}
            </>
          )}
        </div>
        {toolbarSlot}
      </div>
      <div className={cn('flex min-h-0 flex-1', width === 'fill' ? 'flex-col' : 'flex-col md:flex-row')}>
        <div
          ref={container}
          data-text-editor
          className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', preview && 'basis-1/2')}
          style={{ '--pulpo-code-font-size': `${Math.round(BASE_FONT_PX * zoom * 10) / 10}px` } as CSSProperties}
        />
        {preview && (
          <div className={cn('min-h-0 min-w-0 flex-1 basis-1/2 border-t bg-white', width !== 'fill' && 'md:border-t-0 md:border-l')} aria-label={ui("HTML preview")}>
            <HtmlPreview doc={session.doc} name={name} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t px-4 py-1 text-[11px] text-muted-foreground tabular-nums sm:px-6" aria-live="off">
        {state && (
          <button
            type="button"
            className="cursor-pointer rounded px-1 hover:bg-accent hover:text-foreground"
            title={`${ui("Go to line")} (${mac ? '⌃G' : 'Ctrl+G'})`}
            aria-keyshortcuts="Control+g"
            onMouseDown={(event) => event.preventDefault()}
            onClick={run((target) => target.openGotoLine(), { focus: false })}
            data-text-position
          >
            {state.selected ? uit`Ln ${state.line}, Col ${state.column} (${state.selected} selected)` : uit`Ln ${state.line}, Col ${state.column}`}
          </button>
        )}
        {state && <TextStatusCounts editor={editor.current} doc={session.doc} name={name} state={state} open={wordCountOpen} onOpenChange={setWordCountOpen} onDone={() => editor.current?.focus()} />}
        <span className="flex-1" />
        {zoom !== 1 && (
          <button
            type="button"
            className="cursor-pointer rounded px-1 hover:bg-accent hover:text-foreground"
            title={ui("Reset zoom to 100%")}
            aria-label={uit`Zoom ${zoomPercent(zoom)}, reset to 100%`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setZoom(1)}
            data-text-zoom
          >
            {zoomPercent(zoom)}
          </button>
        )}
        {!editable && <span>{ui("Read-only")}</span>}
        <span>{state?.language ?? ui("Plain text")}</span>
        <span>{ENCODING_LABELS[facts.encoding] ?? facts.encoding}</span>
        <span>{facts.lineEnding.toUpperCase()}</span>
      </div>
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        groups={() => shortcutGroupsFromMenus(menus, textShortcutGroups())}
        returnFocus={() => editor.current?.focus()}
      />
    </div>
  )
}

export default TextDocEditor
