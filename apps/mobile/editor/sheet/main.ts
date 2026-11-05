/*
 * The spreadsheet editor that runs inside the app's web view: the shared grid (SheetView from
 * @pulpo/client-core/office/sheets/view) on a replica of the document the app owns, with a phone
 * formula bar, find bar, and sheet tabs around it. The app's native bar sends the formatting and
 * structure commands. Like the other pages, it has no network access and talks only through the
 * bridge (src/features/files/editor/protocol.ts).
 */
import { SHEETS_SCHEMA_VERSION, sheetFormatOf } from '@pulpo/client-core/office/sheets'
import { SheetView, type SheetViewState } from '@pulpo/client-core/office/sheets/view'
import { applyAwarenessUpdate, Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { base64ToBytes, bytesToBase64 } from '../../src/features/files/editor/base64'
import {
  EDITOR_PROTOCOL_VERSION,
  type EditorMessage,
  type EditorTheme,
  type HostMessage,
  type SheetCommand,
  type SheetEditorState,
} from '../../src/features/files/editor/protocol'
import './sheet.css'

declare global {
  interface Window {
    webkit?: { messageHandlers?: { pulpoEditor?: { postMessage(message: string): void } } }
    pulpoEditorAndroid?: { postMessage(message: string): void }
    pulpoEditor: { receive(message: string): void }
  }
}

const HOST = 'host'
const REMOTE = 'remote'

/** Fills the toolbar offers: light tints that keep black text readable. */
const FILLS: Partial<Record<SheetCommand, string>> = {
  fillYellow: 'FFFFF2CC',
  fillGreen: 'FFE2EFDA',
  fillBlue: 'FFDDEBF7',
  fillRed: 'FFFCE4E4',
  fillGray: 'FFEDEDED',
}

/** Number formats the toolbar offers, as the web's number format menu writes them. */
const FORMATS: Partial<Record<SheetCommand, string>> = {
  formatGeneral: 'General',
  formatNumber: '#,##0.00',
  formatCurrency: '"$"#,##0.00',
  formatPercent: '0.00%',
  formatDate: 'm/d/yyyy',
  formatText: '@',
}

/**
 * Images and charts are kept in the document's asset store, which this page can't reach (the
 * bridge carries no asset requests yet, and the page loads nothing from the network): they show
 * their placeholders, and inserting them isn't offered.
 */
const ASSETS = {
  get: () => Promise.reject(new Error('Pictures and charts are not available in the app yet')),
  put: () => Promise.reject(new Error('Pictures and charts are not available in the app yet')),
}

function post(message: EditorMessage): void {
  const data = JSON.stringify(message)
  if (window.webkit?.messageHandlers?.pulpoEditor) window.webkit.messageHandlers.pulpoEditor.postMessage(data)
  else window.pulpoEditorAndroid?.postMessage(data)
}

interface Open {
  session: number
  doc: Y.Doc
  awareness: Awareness
  view: SheetView
  unsubscribe: () => void
}

let open: Open | null = null
let dark = false
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const app = element<HTMLElement>('app')
const grid = element<HTMLDivElement>('grid')
const formulaBar = element<HTMLDivElement>('formula-bar')
const address = element<HTMLSpanElement>('address')
const formula = element<HTMLInputElement>('formula')
const cancelEdit = element<HTMLButtonElement>('cancel-edit')
const commitEdit = element<HTMLButtonElement>('commit-edit')
const findBar = element<HTMLDivElement>('find-bar')
const findInput = element<HTMLInputElement>('find-input')
const findCount = element<HTMLSpanElement>('find-count')
const tabList = element<HTMLDivElement>('tab-list')
const addSheet = element<HTMLButtonElement>('add-sheet')

function applyTheme(theme: EditorTheme): void {
  const style = document.documentElement.style
  style.setProperty('--background', theme.background)
  style.setProperty('--foreground', theme.foreground)
  style.setProperty('--muted', theme.muted)
  style.setProperty('--muted-foreground', theme.mutedForeground)
  style.setProperty('--border', theme.border)
  style.setProperty('--ring', theme.primary)
  style.setProperty('--bottom-padding', `${theme.bottomPadding}px`)
  document.documentElement.classList.toggle('dark', theme.dark)
  document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light'
  dark = theme.dark
  if (open) {
    open.view.options.appearance = theme.dark ? 'dark' : 'light'
    open.view.invalidateAll()
  }
}

/** The page keeps to what the keyboard leaves visible, so the grid and the bars stay in view. */
function fitViewport(): void {
  const viewport = window.visualViewport
  if (!viewport) return
  app.style.height = `${viewport.height}px`
  app.style.transform = viewport.offsetTop ? `translateY(${viewport.offsetTop}px)` : ''
}
window.visualViewport?.addEventListener('resize', fitViewport)
window.visualViewport?.addEventListener('scroll', fitViewport)

// ── Toolbar state ──────────────────────────────────────────────────────────

function activeCommands(state: SheetViewState): SheetCommand[] {
  const style = state.activeStyle
  const active: SheetCommand[] = []
  if (style.bold) active.push('bold')
  if (style.italic) active.push('italic')
  if (style.wrap) active.push('wrap')
  if (style.hAlign === 'left') active.push('alignLeft')
  if (style.hAlign === 'center' || style.hAlign === 'centerContinuous') active.push('alignCenter')
  if (style.hAlign === 'right') active.push('alignRight')
  for (const [command, code] of Object.entries(FORMATS)) {
    if (command !== 'formatGeneral' && code === style.numFmt) active.push(command as SheetCommand)
  }
  const fill = style.fill?.rgb?.toUpperCase()
  for (const [command, rgb] of Object.entries(FILLS)) if (fill && (fill === rgb || `FF${fill}` === rgb)) active.push(command as SheetCommand)
  if (state.frozen.rows > 0) active.push('freezeRow')
  if (state.hasFilter) active.push('filter')
  return active
}

function editorState(state: SheetViewState): SheetEditorState {
  const focused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
  return {
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    readOnly: state.readOnly,
    valuesOnly: state.valuesOnly,
    focused,
    editing: !!state.editing,
    selection: state.selectionLabel,
    active: activeCommands(state),
    frozenRows: state.frozen.rows,
    hasFilter: state.hasFilter,
  }
}

let lastSent = ''
function report(force = false): void {
  if (!open) return
  const state = open.view.getState()
  render(state)
  const message = editorState(state)
  const json = JSON.stringify(message)
  if (!force && json === lastSent) return
  lastSent = json
  post({ type: 'sheetState', session: open.session, state: message })
}

// ── Formula bar ────────────────────────────────────────────────────────────

function render(state: SheetViewState): void {
  address.textContent = state.selectionLabel
  const text = state.editing?.text ?? state.activeInput
  if (formula.value !== text) {
    const focused = document.activeElement === formula
    formula.value = text
    // Pointing at cells while a formula is typed here inserts references; the caret follows them.
    if (focused && state.editing) formula.setSelectionRange(state.editing.caret, state.editing.caret)
  }
  formula.readOnly = state.readOnly
  cancelEdit.hidden = !state.editing
  commitEdit.hidden = !state.editing
  renderTabs(state)
}

formula.addEventListener('input', () => {
  const view = open?.view
  if (!view) return
  if (!view.editing) view.beginEdit(formula.value, false)
  else view.setEditText(formula.value, formula.selectionStart ?? formula.value.length)
})
formula.addEventListener('select', () => {
  const view = open?.view
  if (view?.editing) view.setEditText(formula.value, formula.selectionStart ?? formula.value.length)
})
formula.addEventListener('focus', () => report())
formula.addEventListener('blur', () => report())
formula.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return
  const view = open?.view
  if (!view) return
  if (event.key === 'Enter') {
    event.preventDefault()
    finishEdit(true)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    view.cancelEdit()
    view.focus()
  }
})

/** Ends the edit from the bar: commits and moves down as Return does, or keeps the cell as it was. */
function finishEdit(commit: boolean): void {
  const view = open?.view
  if (!view) return
  if (!commit) {
    view.cancelEdit()
    formula.value = view.getState().activeInput
  } else if (view.editing) {
    // A value the cell's validation refuses keeps the edit open, with the grid's message.
    if (!view.commitEdit()) return
    view.clipboard.moveWithin(1, 0)
  }
  // Typing goes back to the grid, which keeps the keyboard up for the next cell.
  view.focus()
  report()
}

// Buttons act on press, before focus would leave the field (which keeps the keyboard up).
for (const [button, commit] of [[commitEdit, true], [cancelEdit, false]] as const) {
  button.addEventListener('pointerdown', (event) => event.preventDefault())
  button.addEventListener('click', () => finishEdit(commit))
}

// ── Sheet tabs ─────────────────────────────────────────────────────────────

let tabsKey = ''
function renderTabs(state: SheetViewState): void {
  const visible = state.sheets.filter((sheet) => sheet.state === 'visible')
  const editable = !state.readOnly && !state.valuesOnly
  addSheet.hidden = !editable
  const key = JSON.stringify([visible, state.sheetId])
  if (key === tabsKey) return
  tabsKey = key
  tabList.replaceChildren(...visible.map((sheet) => {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = 'tab'
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(sheet.id === state.sheetId))
    if (sheet.color) {
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      swatch.style.background = sheet.color
      tab.append(swatch)
      tab.style.setProperty('--tab-color', sheet.color)
    }
    tab.append(sheet.name)
    tab.addEventListener('click', () => {
      open?.view.setActiveSheet(sheet.id)
      report()
    })
    return tab
  }))
  tabList.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}

addSheet.addEventListener('click', () => {
  open?.view.addSheet()
  report()
})

// ── Find ───────────────────────────────────────────────────────────────────

let matches: { sheetId: string; row: number; col: number }[] = []
let matchIndex = -1

function showMatch(index: number): void {
  const view = open?.view
  if (!view || !matches.length) return
  matchIndex = (index + matches.length) % matches.length
  const match = matches[matchIndex]!
  if (match.sheetId !== view.sheetId) view.setActiveSheet(match.sheetId)
  view.select({ top: match.row, left: match.col, bottom: match.row, right: match.col })
  findCount.textContent = `${matchIndex + 1} of ${matches.length}`
}

function search(): void {
  const view = open?.view
  if (!view) return
  matches = view.find(findInput.value, { allSheets: true })
  matchIndex = -1
  if (!findInput.value) findCount.textContent = ''
  else if (!matches.length) findCount.textContent = 'No matches'
  else showMatch(0)
}

function openFind(): void {
  open?.view.commitEdit()
  formulaBar.hidden = true
  findBar.hidden = false
  findInput.focus()
  findInput.select()
  if (findInput.value) search()
}

function closeFind(): void {
  findBar.hidden = true
  formulaBar.hidden = false
  open?.view.focus()
  report()
}

findInput.addEventListener('input', search)
findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    showMatch(matchIndex + (event.shiftKey ? -1 : 1))
  } else if (event.key === 'Escape') closeFind()
})
for (const [id, step] of [['find-previous', -1], ['find-next', 1]] as const) {
  const button = element<HTMLButtonElement>(id)
  button.addEventListener('pointerdown', (event) => event.preventDefault())
  button.addEventListener('click', () => showMatch(matchIndex + step))
}
element<HTMLButtonElement>('find-done').addEventListener('click', closeFind)

// ── Commands from the app's toolbar ────────────────────────────────────────

function run(view: SheetView, command: SheetCommand): void {
  const state = view.getState()
  const style = state.activeStyle
  const toggleAlign = (align: 'left' | 'center' | 'right') => view.setStyle({ hAlign: style.hAlign === align ? 'general' : align })
  if (command === 'find') {
    openFind()
    return
  }
  // A command acts on what was typed so far, as clicking a toolbar on the web does.
  if (command !== 'undo' && command !== 'redo' && view.editing && !view.commitEdit()) return
  switch (command) {
    case 'undo': view.undo(); break
    case 'redo': view.redo(); break
    case 'bold': view.toggleStyle('bold'); break
    case 'italic': view.toggleStyle('italic'); break
    case 'wrap': view.toggleStyle('wrap'); break
    case 'alignLeft': toggleAlign('left'); break
    case 'alignCenter': toggleAlign('center'); break
    case 'alignRight': toggleAlign('right'); break
    case 'fillNone': view.setStyle({ fill: null }); break
    case 'insertRowAbove': view.insert('row', 'before'); break
    case 'insertRowBelow': view.insert('row', 'after'); break
    case 'insertColumnLeft': view.insert('col', 'before'); break
    case 'insertColumnRight': view.insert('col', 'after'); break
    case 'deleteRow': view.deleteLines('row'); break
    case 'deleteColumn': view.deleteLines('col'); break
    case 'freezeRow': view.freeze(state.frozen.rows > 0 ? 0 : 1, state.frozen.cols); break
    case 'sortAscending': view.sort(false); break
    case 'sortDescending': view.sort(true); break
    case 'filter': view.toggleFilter(); break
    default: {
      const fill = FILLS[command]
      const format = FORMATS[command]
      if (fill) view.setStyle({ fill: { rgb: fill } })
      else if (format) view.setNumberFormat(format)
    }
  }
}

// ── Session ────────────────────────────────────────────────────────────────

function close(): void {
  if (!open) return
  const current = open
  open = null
  current.unsubscribe()
  current.view.destroy()
  removeAwarenessStates(current.awareness, [current.doc.clientID], 'local')
  current.awareness.destroy()
  current.doc.destroy()
  lastSent = ''
  tabsKey = ''
  matches = []
  closeFind()
}

function start(message: Extract<HostMessage, { type: 'init' }>): void {
  close()
  applyTheme(message.theme)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, base64ToBytes(message.update), HOST)
  const awareness = new Awareness(doc)
  if (message.awareness) applyAwarenessUpdate(awareness, base64ToBytes(message.awareness), REMOTE)
  const session = message.session
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== HOST && open?.session === session) post({ type: 'update', session, update: bytesToBase64(update) })
  })
  awareness.on('update', ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
    if (origin === REMOTE || open?.session !== session) return
    if (![...added, ...updated].includes(doc.clientID)) return
    const selection = (awareness.getLocalState() as { sheet?: unknown } | null)?.sheet ?? null
    post({ type: 'selection', session, selection })
  })
  const view = new SheetView({
    container: grid,
    doc,
    awareness,
    readOnly: !message.editable,
    fileFormat: message.name ? sheetFormatOf(message.name) : undefined,
    assets: ASSETS,
    user: message.user,
    appearance: dark ? 'dark' : 'light',
  })
  const unsubscribe = view.subscribe(() => report())
  open = { session, doc, awareness, view, unsubscribe }
  fitViewport()
  post({ type: 'loaded', session })
  // Whatever reached the app after it sent `init`.
  post({ type: 'sync', session, stateVector: bytesToBase64(Y.encodeStateVector(doc)) })
  report(true)
}

function receive(raw: string): void {
  let message: HostMessage
  try {
    message = JSON.parse(raw) as HostMessage
  } catch {
    return
  }
  if (message.type === 'init') {
    start(message)
    return
  }
  const current = open
  if (!current || message.session !== current.session) return
  switch (message.type) {
    case 'update':
      Y.applyUpdate(current.doc, base64ToBytes(message.update), HOST)
      break
    case 'sync':
      post({ type: 'update', session: current.session, update: bytesToBase64(Y.encodeStateAsUpdate(current.doc, base64ToBytes(message.stateVector))) })
      break
    case 'awareness':
      applyAwarenessUpdate(current.awareness, base64ToBytes(message.update), REMOTE)
      break
    case 'name':
      current.view.setFileFormat(sheetFormatOf(message.name))
      break
    case 'editable':
      current.view.readOnly = !message.editable
      current.view.scheduleRender()
      current.view.notify()
      break
    case 'theme':
      applyTheme(message.theme)
      break
    case 'command':
      run(current.view, message.command as SheetCommand)
      report()
      break
    case 'focus':
      current.view.focus()
      break
    case 'blur':
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      break
    case 'export':
      // The app downloads spreadsheets from the server, which exports them through the codec.
      post({ type: 'export', session: current.session, requestId: message.requestId, markdown: null, error: 'Spreadsheets are exported by the server' })
      break
  }
}

window.pulpoEditor = {
  receive: (message) => {
    try {
      receive(message)
    } catch (error) {
      post({ type: 'error', session: open?.session ?? null, message: error instanceof Error ? error.message : String(error) })
    }
  },
}

window.addEventListener('error', (event) => {
  post({ type: 'error', session: open?.session ?? null, message: event.message })
})

/** The whole replica, for the app to merge when it tears the web view down (see the native host). */
;(window as unknown as { pulpoEditorState: () => string | null }).pulpoEditorState = () => {
  if (!open) return null
  open.view.settleEdit()
  return bytesToBase64(Y.encodeStateAsUpdate(open.doc))
}

post({ type: 'ready', protocolVersion: EDITOR_PROTOCOL_VERSION, schemaVersion: SHEETS_SCHEMA_VERSION, format: 'sheet' })
