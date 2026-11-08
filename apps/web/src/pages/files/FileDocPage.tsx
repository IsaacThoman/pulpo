import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import { liveFormat, liveFormatOfName } from '@pulpo/client-core/office'
import { fileExtension, fileNameError, isMarkdownName, normalizeFileName, type FileConversionPreview, type FileNode } from '@pulpo/contracts'
import { ChevronRight, CloudCheck, CloudOff, Download, FolderOpen, HardDrive, Loader2, Pencil, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ui, uit } from '@/i18n/ui'
import { formatBytes } from '@/lib/attachments'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { Markdown } from '@/components/chat/Markdown'
import {
  convertToDoc,
  downloadDocMarkdown,
  downloadFile,
  downloadLiveDoc,
  fetchConversionPreview,
  fetchFileBlob,
  fetchFileNode,
  fileNodeQueryKey,
  filesQueryKey,
  updateFileNode,
} from '@/features/files/api'
import { fileNameErrorMessage, filePreviewKind, filesErrorMessage, MAX_INLINE_PREVIEW_BYTES, previewFillsView } from '@/features/files/file-display'
import { OfficeConversionBanner, OfficeFileHeaderActions, OfficePdfPreview } from '@/features/files/OfficeFile'
import { officeFileActions, useOfficeConversion } from '@/features/files/office-file'
import { focusFileEditorIn } from '@/features/files/live/chrome/use-editor-shortcuts'
import { takeTitleFocus } from '@/features/files/title-focus'
import { useFileMenuHost } from '@/features/files/use-file-menu'
import { useDocumentTitle } from '@/lib/document-title'
import { DocEditor } from '@/features/files/editor/DocEditor'
import type { DocSyncStatus } from '@pulpo/client-core/doc-sync'
import { useDocSession, type PresencePeer } from '@/features/files/editor/use-doc-session'
import { useSuggestionRecount } from '@/features/files/editor/use-suggestion-recount'
import { FilePreviewBody } from '@/features/files/FilePreview'
import { ApiLiveAssetStore } from '@/features/files/live/assets'
import { liveWebFormat, type LiveFormatWeb } from '@/features/files/live/registry'
import { FileSuggestionBanner } from '@/features/files/FileSuggestion'
import { MarkdownConversionDialog } from '@/features/files/MarkdownConversionDialog'
import { revealFileInPlace } from '@/features/files/reveal'
import { PanelWindowButtons } from '@/features/side-panel/PanelControls'
import { locationIsCurrent, openBeside, panelContentPath, useMainNavigate } from '@/features/side-panel/use-panel-actions'
import { SplitViewButton } from '@/features/side-panel/AgentActions'
import { runWithAgent, usePublishFilesView, type AgentItem, type FilesViewPlace } from '@/features/side-panel/agent'
import { useSidePanel, type PanelContent } from '@/features/side-panel/store'

function statusProblem(status: DocSyncStatus): string | null {
  if (status.state === 'closed') {
    if (status.reason === 'trashed') return ui("This document was moved to the trash. Restore it to keep editing.")
    if (status.reason === 'converted') return ui("This file was renamed to another type, so it's no longer editable here.")
    return ui("This document was deleted.")
  }
  // A stale copy is dropped and the session starts over by itself (see useDocSession).
  if (status.state !== 'error' || status.error === 'rate_limited' || status.error === 'stale_copy') return null
  switch (status.error) {
    case 'schema_outdated': return ui("A newer version of Pulpo is available. Reload to keep editing.")
    case 'doc_too_large': return ui("This document is too large to edit.")
    case 'unauthorized': return ui("You can't edit this document.")
    default: return ui("Syncing stopped. Reload to keep editing.")
  }
}

type SaveState = 'saving' | 'saved' | 'offline'

/** "Saving…" shows only once a save takes this long, so typing (a quick save per keystroke) does not strobe it… */
const SAVING_DELAY_MS = 500
/** …and then stays at least this long. */
const SAVING_MIN_MS = 400
/** How long Cmd/Ctrl+S's "All changes saved" shows. */
const SAVE_CONFIRM_MS = 2_000

function saveStateOf(status: DocSyncStatus): SaveState | null {
  if (status.state === 'synced') return 'saved'
  if (status.state === 'offline') return 'offline'
  if (status.state === 'connecting' || status.state === 'syncing' || (status.state === 'error' && status.error === 'rate_limited')) return 'saving'
  // Errors and closed documents have their own banner.
  return null
}

/** The save state to show: the session's, with "Saving…" debounced as above. */
function useShownSaveState(status: DocSyncStatus): SaveState | null {
  const actual = saveStateOf(status)
  const [shown, setShown] = useState<SaveState | null>(actual === 'saving' ? null : actual)
  const savingSince = useRef(0)
  useEffect(() => {
    if (actual === shown) return
    if (actual === 'saving') {
      const timer = window.setTimeout(() => {
        savingSince.current = Date.now()
        setShown('saving')
      }, SAVING_DELAY_MS)
      return () => window.clearTimeout(timer)
    }
    const wait = shown === 'saving' ? Math.max(0, savingSince.current + SAVING_MIN_MS - Date.now()) : 0
    const timer = window.setTimeout(() => setShown(actual), wait)
    return () => window.clearTimeout(timer)
  }, [actual, shown])
  return shown
}

/**
 * Saved, Saving…, or Offline, as Word and Docs say it (Pulpo saves as people type). `confirm`
 * changes on Cmd/Ctrl+S, which briefly reads "All changes saved" and announces it.
 * `data-sync-state` is the session's own state, for tests.
 */
function SaveStatus({ status, confirm = 0 }: { status: DocSyncStatus; confirm?: number }) {
  const shown = useShownSaveState(status)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirm) return
    setConfirming(true)
    const timer = window.setTimeout(() => setConfirming(false), SAVE_CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [confirm])
  const announcement = !confirming ? '' : shown === 'saved' ? ui("All changes saved") : shown === 'offline' ? ui("Offline: edits are kept on this device") : ui("Saving…")
  const label = 'flex items-center gap-1.5 text-xs whitespace-nowrap transition-colors'
  return (
    <>
      {shown === 'saved' && (
        <span className={cn(label, confirming ? 'text-foreground' : 'text-muted-foreground')} data-sync-state={status.state} data-save-state="saved">
          <CloudCheck className="size-3.5" />{confirming ? ui("All changes saved") : ui("Saved")}
        </span>
      )}
      {shown === 'saving' && (
        <span className={cn(label, 'text-muted-foreground')} data-sync-state={status.state} data-save-state="saving">
          <Loader2 className="size-3.5 animate-spin" />{ui("Saving…")}
        </span>
      )}
      {shown === 'offline' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(label, 'text-amber-600 dark:text-amber-400')} data-sync-state={status.state} data-save-state="offline">
              <CloudOff className="size-3.5" />{ui("Offline")}
            </span>
          </TooltipTrigger>
          <TooltipContent>{ui("Edits are kept on this device and save when you reconnect.")}</TooltipContent>
        </Tooltip>
      )}
      <span className="sr-only" role="status">{announcement}</span>
    </>
  )
}

function Presence({ peers }: { peers: PresencePeer[] }) {
  if (!peers.length) return null
  return (
    <div className="flex items-center -space-x-1.5" aria-label={ui("Also editing")}>
      {peers.slice(0, 4).map((peer) => (
        <Tooltip key={peer.clientId}>
          <TooltipTrigger asChild>
            <span
              className="grid size-6 place-items-center rounded-full border-2 border-background text-[10px] font-semibold text-white"
              style={{ backgroundColor: peer.color }}
            >
              {peer.name.slice(0, 1).toUpperCase()}
            </span>
          </TooltipTrigger>
          <TooltipContent>{peer.name}</TooltipContent>
        </Tooltip>
      ))}
      {peers.length > 4 && <span className="grid size-6 place-items-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold">+{peers.length - 4}</span>}
    </div>
  )
}

/** A name without its extension: what the browser tab shows for a document, and what renaming selects. */
function nameStem(node: Pick<FileNode, 'kind' | 'name'>, name = node.name): string {
  const dot = node.kind === 'folder' ? -1 : name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * The name a title edit saves, or why it can't. A document keeps its type: typing over the whole
 * name keeps the extension ("Q3 plan" stays "Q3 plan.docx"), and an extension of another format
 * is refused, since that would turn the document into an ordinary file (Files can still do it).
 */
function titleName(node: FileNode, typed: string): { name: string } | { error: string } {
  let name = normalizeFileName(typed)
  if (!name || name === node.name) return { name: node.name }
  if (node.kind === 'doc') {
    const extension = fileExtension(node.name)
    if (extension && !fileExtension(name)) name = `${name}.${extension}`
    if (liveFormatOfName(name)?.id !== liveFormatOfName(node.name)?.id) {
      return { error: extension ? ui("Keep the .{{extension}} extension: another one would change what kind of file this is.", { extension }) : ui("That name would change what kind of file this is.") }
    }
  }
  const invalid = fileNameError(name)
  return invalid ? { error: fileNameErrorMessage(invalid) } : { name }
}

/** Puts focus back in the document of the view holding `element` (after Enter in the title). */
function focusDocumentOf(element: Element): void {
  const view = element.closest('[data-file-view]')
  if (!view || focusFileEditorIn(view)) return
  view.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
}

function DocTitle({ node, inputRef }: { node: FileNode; inputRef?: RefObject<HTMLInputElement | null> }) {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const [name, setName] = useState(node.name)
  const [error, setError] = useState<string | null>(null)
  const ownInput = useRef<HTMLInputElement>(null)
  const input = inputRef ?? ownInput
  // Escape blurs the field too; the blur must not save the name being abandoned.
  const cancelled = useRef(false)
  // Enter returns to the document once the name is saved.
  const returning = useRef(false)
  // A click that focuses the field keeps the selection the focus made.
  const clickFocus = useRef(false)
  useEffect(() => setName(node.name), [node.name])
  // A document Files just created opens with its name selected, ready to type over.
  useEffect(() => {
    if (takeTitleFocus(node.id)) input.current?.focus()
  }, [node.id, input])

  const save = async () => {
    const element = input.current
    const back = returning.current
    returning.current = false
    if (cancelled.current) {
      cancelled.current = false
      setName(node.name)
      setError(null)
      if (back && element) focusDocumentOf(element)
      return
    }
    const result = titleName(node, name)
    if ('error' in result) {
      setError(result.error)
      setName(node.name)
      return
    }
    setError(null)
    setName(result.name)
    if (back && element) focusDocumentOf(element)
    if (result.name === node.name) return
    try {
      await updateFileNode(node.id, { name: result.name, expectedRevision: node.revision })
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
    } catch (cause) {
      setError(filesErrorMessage(cause, result.name))
      setName(node.name)
    }
  }

  const text = 'px-1.5 py-0.5 text-lg font-semibold tracking-tight'
  return (
    <div className="min-w-0 flex-1">
      {/* The field is as wide as its text: a hidden copy of the name sizes the shared grid cell,
          so the clickable area follows the name as it is edited and truncates when it is long. */}
      <div className="inline-grid max-w-full grid-cols-[minmax(0,auto)] align-top">
        <span aria-hidden className={cn('invisible col-start-1 row-start-1 truncate whitespace-pre pr-2.5', text)}>{name || ' '}</span>
        <input
          ref={input}
          value={name}
          // Without a size the field asks for about 20 characters and sets the width itself.
          size={1}
          aria-label={ui("Document name")}
          aria-invalid={Boolean(error)}
          onChange={(event) => { setName(event.target.value); setError(null) }}
          // Selects the name without its extension, so typing renames and keeps the type.
          onFocus={(event) => event.currentTarget.setSelectionRange(0, nameStem(node, event.currentTarget.value).length)}
          onMouseDown={(event) => { clickFocus.current = document.activeElement !== event.currentTarget }}
          onMouseUp={(event) => {
            if (!clickFocus.current) return
            clickFocus.current = false
            // The click placed the caret after the focus selected; select again, as Docs' title does.
            event.preventDefault()
            event.currentTarget.setSelectionRange(0, nameStem(node, event.currentTarget.value).length)
          }}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const result = titleName(node, name)
              // A name that can't be saved stays for fixing.
              if ('error' in result) setError(result.error)
              else { returning.current = true; event.currentTarget.blur() }
            }
            if (event.key === 'Escape') { cancelled.current = true; returning.current = true; setName(node.name); event.currentTarget.blur() }
          }}
          className={cn('col-start-1 row-start-1 w-full min-w-0 truncate rounded-md bg-transparent outline-none hover:bg-accent/60 focus:bg-accent/60', text)}
        />
      </div>
      {error && <p role="alert" className="px-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** The browser tab (and desktop window) shows the open file's name: a document's without its extension. */
function PageTitle({ node }: { node: FileNode | undefined }) {
  useDocumentTitle(node ? (node.kind === 'doc' ? nameStem(node) : node.name) : null)
  return null
}

/**
 * The folders above a file. In the side panel they open there, so the panel can walk back up;
 * Alt/Option-click opens one in the other view, as in the Files browser.
 */
function FilePath({ ancestors, inPanel }: { ancestors: FileNode[]; inPanel: boolean }) {
  const goMain = useMainNavigate()
  const showInPanel = (id: string | null) => (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    const folder = { kind: 'folder' as const, id }
    if (event.altKey) {
      event.preventDefault()
      if (inPanel) {
        useSidePanel.getState().close()
        goMain(panelContentPath(folder))
      } else {
        openBeside(folder, goMain)
      }
    } else if (inPanel) {
      event.preventDefault()
      useSidePanel.getState().open(folder)
    }
  }
  return (
    <nav aria-label={ui("Folder path")} className="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
      <Link to="/files" onClick={showInPanel(null)} className="flex shrink-0 items-center gap-1 rounded px-1 hover:text-foreground"><HardDrive className="size-3" />{ui("My files")}</Link>
      {ancestors.map((folder) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight className="size-3 shrink-0" />
          <Link to={`/files/f/${folder.id}`} onClick={showInPanel(folder.id)} className="truncate rounded px-1 hover:text-foreground">{folder.name}</Link>
        </span>
      ))}
    </nav>
  )
}

/** Where a file view renders: the full page, or the side panel next to another view. */
interface FileViewContext {
  layout: 'page' | 'panel'
  /** Set in the side panel, for its window controls. */
  panel?: PanelContent
}

const PAGE_VIEW: FileViewContext = { layout: 'page' }

/**
 * A suggested file's banner. Rejecting deletes the suggestion (the file, or the suggested folder
 * it is in), so the view closes or shows the folder that held it.
 */
function SuggestionBanner({ node, ancestors, view }: { node: FileNode | undefined; ancestors: FileNode[]; view: FileViewContext }) {
  const navigate = useNavigate()
  if (!node?.suggestion) return null
  return (
    <FileSuggestionBanner
      node={node}
      ancestors={ancestors}
      onRejected={(root) => {
        if (view.layout === 'panel') useSidePanel.getState().close()
        else navigate(root.parentId ? `/files/f/${root.parentId}` : '/files', { replace: true })
      }}
    />
  )
}

/** Title bar shared by every file view; in the side panel it adds full-page and close buttons. */
function FileHeader({ node, ancestors, view, onDownload, titleRef, children }: {
  node: FileNode | undefined
  ancestors: FileNode[]
  view: FileViewContext
  onDownload: () => void
  /** The title field, for File ▸ Rename. */
  titleRef?: RefObject<HTMLInputElement | null>
  children?: ReactNode
}) {
  const place = useMemo<FilesViewPlace | null>(() => node ? { layout: view.layout, view: { kind: 'file', id: node.id } } : null, [node, view.layout])
  const item = useMemo<AgentItem | null>(() => node ? { id: node.id } : null, [node])
  usePublishFilesView(place ?? { layout: view.layout, view: { kind: 'folder', id: null } }, item)
  const goMain = useMainNavigate()
  return (
    <header className={cn('flex items-center gap-1.5 border-b px-4 py-1.5', view.layout === 'panel' ? 'side-panel-header' : 'mobile-page-content')}>
      <div className="min-w-0 flex-1">
        <FilePath ancestors={ancestors} inPanel={view.layout === 'panel'} />
        {node ? <DocTitle node={node} inputRef={titleRef} /> : <div className="h-8" />}
      </div>
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={ui("Show in folder")} disabled={!node} onClick={() => node && revealFileInPlace(node, view.layout === 'panel', goMain)}><FolderOpen /></Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{ui("Show in folder")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={ui("Download")} disabled={!node} onClick={onDownload}><Download /></Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{ui("Download")}</TooltipContent>
      </Tooltip>
      {view.panel ? <PanelWindowButtons content={view.panel} /> : place && <SplitViewButton view={place.view} />}
    </header>
  )
}

function OpenDoc({ userId, docId, view }: { userId: string; docId: string; view: FileViewContext }) {
  const nodeQuery = useQuery({ queryKey: fileNodeQueryKey(userId, docId), queryFn: () => fetchFileNode(docId) })
  const { session, status, peers } = useDocSession(userId, docId)
  const recountSuggestions = useSuggestionRecount(userId, status)
  const [everSynced, setEverSynced] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const chatWidth = useSettings((state) => state.chatWidth)
  const dictationEnabled = useAuth((state) => state.dictationEnabled)

  useEffect(() => setEverSynced(false), [docId])
  useEffect(() => { if (status.state === 'synced') setEverSynced(true) }, [status.state])

  const node = nodeQuery.data?.node
  const ancestors = nodeQuery.data?.ancestors ?? []
  const parentPath = node?.parentId ? `/files/f/${node.parentId}` : '/files'
  const problem = statusProblem(status)
  // Before the first sync, only allow typing when a cached copy is already on screen.
  const hasContent = Boolean(session?.hasCachedContent)
  const editable = !problem && Boolean(node && !node.trashedAt) && (everSynced || hasContent)

  return (
    <div className="flex h-full min-h-0 flex-col" data-file-view="">
      <FileHeader
        node={node}
        ancestors={ancestors}
        view={view}
        onDownload={() => {
          if (!node) return
          void (async () => downloadDocMarkdown(node, session && (everSynced || hasContent) ? ydocToMarkdown(session.doc) : undefined))()
            .catch((cause: unknown) => setNotice(filesErrorMessage(cause)))
        }}
      >
        <Presence peers={peers} />
        <SaveStatus status={status} />
      </FileHeader>
      <SuggestionBanner node={node} ancestors={ancestors} view={view} />

      {(problem || notice) && (
        <div role="alert" className={cn('flex items-center gap-2 border-b px-4 py-2 text-sm sm:px-6', problem ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-destructive/5 text-destructive')}>
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{problem ?? notice}</span>
          {status.state === 'error' && <Button size="sm" variant="outline" onClick={() => window.location.reload()}>{ui("Reload")}</Button>}
          {status.state === 'closed' && <Button asChild size="sm" variant="outline"><Link to={status.reason === 'trashed' ? '/files/trash' : parentPath}>{status.reason === 'trashed' ? ui("Open trash") : ui("Back to My files")}</Link></Button>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {session ? (
          <DocEditor
            key={docId}
            session={session}
            editable={editable}
            dictation={dictationEnabled}
            width={view.layout === 'panel' ? 'fill' : chatWidth === 'full' ? 'wide' : 'narrow'}
            onSuggestionsResolved={recountSuggestions}
          />
        ) : (
          <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">{peers.length ? uit`${peers.length} other sessions are editing` : ''}</span>
    </div>
  )
}

/**
 * A live document of a format other than Markdown: the same header, presence, sync state, and
 * problems as Markdown documents, around the format's own editor.
 */
function OpenLiveDoc({ userId, docId, view, web }: { userId: string; docId: string; view: FileViewContext; web: LiveFormatWeb }) {
  const nodeQuery = useQuery({ queryKey: fileNodeQueryKey(userId, docId), queryFn: () => fetchFileNode(docId) })
  const { session, status, peers } = useDocSession(userId, docId, web.format)
  const [everSynced, setEverSynced] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const chatWidth = useSettings((state) => state.chatWidth)
  const assets = useMemo(() => new ApiLiveAssetStore(docId), [docId])
  const go = useMainNavigate()
  const conversion = useOfficeConversion(() => {})
  const officeEnabled = useAuth((state) => state.officeConversionEnabled)
  const titleRef = useRef<HTMLInputElement>(null)
  // Counts Cmd/Ctrl+S presses; the save status confirms each.
  const [saveConfirm, setSaveConfirm] = useState(0)
  const { Editor } = web

  useEffect(() => setEverSynced(false), [docId])
  useEffect(() => { if (status.state === 'synced') setEverSynced(true) }, [status.state])

  const node = nodeQuery.data?.node
  const ancestors = nodeQuery.data?.ancestors ?? []
  const parentPath = node?.parentId ? `/files/f/${node.parentId}` : '/files'
  const problem = statusProblem(status)
  const hasContent = Boolean(session?.hasCachedContent)
  const loaded = everSynced || hasContent
  const editable = !problem && Boolean(node && !node.trashedAt) && loaded
  const loading = <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  const download = () => {
    if (!node) return
    void (async () => downloadLiveDoc(node, session && loaded ? await web.exportFile(session.doc, node.name, assets) : undefined))()
      .catch((cause: unknown) => setNotice(filesErrorMessage(cause)))
  }
  // The server's PDF (with the office converter) is File ▸ Download ▸ PDF; without it, Print saves PDFs.
  const fileMenu = useFileMenuHost({
    node,
    ancestors,
    layout: view.layout,
    titleRef,
    download,
    downloadPdf: node && officeFileActions(node, officeEnabled).pdf ? () => void conversion.downloadPdf(node) : undefined,
  })

  return (
    <div className="flex h-full min-h-0 flex-col" data-file-view="">
      <FileHeader node={node} ancestors={ancestors} view={view} onDownload={download} titleRef={titleRef}>
        <Presence peers={peers} />
        <SaveStatus status={status} confirm={saveConfirm} />
      </FileHeader>
      <SuggestionBanner node={node} ancestors={ancestors} view={view} />

      {(problem || notice) && (
        <div role="alert" className={cn('flex items-center gap-2 border-b px-4 py-2 text-sm sm:px-6', problem ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-destructive/5 text-destructive')}>
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{problem ?? notice}</span>
          {status.state === 'error' && <Button size="sm" variant="outline" onClick={() => window.location.reload()}>{ui("Reload")}</Button>}
          {status.state === 'closed' && <Button asChild size="sm" variant="outline"><Link to={status.reason === 'trashed' ? '/files/trash' : parentPath}>{status.reason === 'trashed' ? ui("Open trash") : ui("Back to My files")}</Link></Button>}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {/* Before the first sync, show nothing rather than an empty file someone could type into. */}
        {session && node && loaded ? (
          <Suspense fallback={loading}>
            <Editor
              key={docId}
              session={session}
              name={node.name}
              editable={editable}
              width={view.layout === 'panel' ? 'fill' : chatWidth === 'full' ? 'wide' : 'narrow'}
              assets={assets}
              onRunWithAgent={web.runsWithAgent && editable ? () => runWithAgent(docId, { layout: view.layout, view: view.panel ?? { kind: 'file', id: docId } }, go) : undefined}
              fileMenu={fileMenu.host}
              onSaveShortcut={() => setSaveConfirm((count) => count + 1)}
            />
          </Suspense>
        ) : loading}
      </div>
      {fileMenu.dialogs}
      <span className="sr-only" aria-live="polite">{peers.length ? uit`${peers.length} other sessions are editing` : ''}</span>
    </div>
  )
}

function contentWidth(view: FileViewContext, chatWidth: 'full' | 'narrow'): string {
  if (view.layout === 'panel') return 'w-full px-5 py-5'
  return cn('mx-auto w-full px-4 py-8 sm:px-6', chatWidth === 'full' ? 'max-w-[min(100%,90rem)]' : 'max-w-5xl')
}

/**
 * An uploaded Markdown file keeps its original bytes and opens read-only. Edit converts it into
 * an editable document, after showing what the editor's formatting would change, if anything.
 */
function MarkdownFileView({ node, ancestors, view }: { node: FileNode; ancestors: FileNode[]; view: FileViewContext }) {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const chatWidth = useSettings((state) => state.chatWidth)
  const content = useQuery({
    queryKey: [...fileNodeQueryKey(userId, node.id), 'content', node.updatedAt],
    queryFn: async () => (await fetchFileBlob(node)).text(),
  })
  const [preview, setPreview] = useState<FileConversionPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const convert = async () => {
    setBusy(true)
    try {
      await convertToDoc(node.id)
      // The route re-reads the node and switches to the editor.
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
      setPreview(null)
    } catch (cause) {
      setNotice(filesErrorMessage(cause))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const startEditing = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const dryRun = await fetchConversionPreview(node.id)
      if (dryRun.changed) setPreview(dryRun)
      else await convert()
    } catch (cause) {
      setNotice(filesErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-file-view="">
      <FileHeader
        node={node}
        ancestors={ancestors}
        view={view}
        onDownload={() => void downloadFile(node).catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}
      >
        <span className={cn('text-xs text-muted-foreground', view.layout === 'panel' ? 'hidden' : 'hidden sm:inline')}>{ui("Read-only")}</span>
        <Button size="sm" disabled={busy || node.trashedAt !== null} onClick={() => void startEditing()}>
          {busy ? <Loader2 className="animate-spin" /> : <Pencil />} {ui("Edit")}
        </Button>
      </FileHeader>
      <SuggestionBanner node={node} ancestors={ancestors} view={view} />
      {notice && (
        <div role="alert" className="flex items-center gap-2 border-b bg-destructive/5 px-4 py-2 text-sm text-destructive sm:px-6">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={contentWidth(view, chatWidth)}>
          {content.isPending ? (
            <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : content.isError ? (
            <p className="text-sm text-destructive">{filesErrorMessage(content.error)}</p>
          ) : content.data.trim() ? (
            <Markdown content={content.data} />
          ) : (
            <p className="text-sm text-muted-foreground">{ui("This file is empty.")}</p>
          )}
        </div>
      </div>
      <MarkdownConversionDialog preview={preview} busy={busy} onCancel={() => setPreview(null)} onConfirm={() => void convert()} />
    </div>
  )
}

/**
 * Any other uploaded file: a preview filling the page or panel, with download. Office files the
 * browser cannot show are previewed as PDF and offer conversion, when the server can convert.
 */
function BlobFileView({ node, ancestors, view }: { node: FileNode; ancestors: FileNode[]; view: FileViewContext }) {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Files of a format whose codec keeps every byte become live documents without asking.
  const format = liveFormatOfName(node.name)
  const editable = Boolean(format?.lossless && liveWebFormat({ kind: 'doc', format: format.id })) && node.sizeBytes <= (format?.maxFileBytes ?? 0)
  const edit = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await convertToDoc(node.id)
      // The route re-reads the node and switches to the editor.
      await queryClient.invalidateQueries({ queryKey: filesQueryKey(userId) })
    } catch (cause) {
      setNotice(filesErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const navigate = useNavigate()
  const officeEnabled = useAuth((state) => state.officeConversionEnabled)
  const conversion = useOfficeConversion((created) => {
    // The copy opens where the original is shown.
    if (view.layout === 'panel') useSidePanel.getState().open({ kind: 'file', id: created.id })
    else navigate(`/files/d/${created.id}`)
  })
  const office = officeFileActions(node, officeEnabled)
  return (
    <div className="flex h-full min-h-0 flex-col" data-file-view="">
      <FileHeader
        node={node}
        ancestors={ancestors}
        view={view}
        onDownload={() => void downloadFile(node).catch((cause: unknown) => setNotice(filesErrorMessage(cause)))}
      >
        <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{formatBytes(node.sizeBytes)}</span>
        {editable && (
          <Button size="sm" disabled={busy || node.trashedAt !== null} onClick={() => void edit()}>
            {busy ? <Loader2 className="animate-spin" /> : <Pencil />} {ui("Edit")}
          </Button>
        )}
        <OfficeFileHeaderActions node={node} conversion={conversion} compact={view.layout === 'panel'} />
      </FileHeader>
      <SuggestionBanner node={node} ancestors={ancestors} view={view} />
      <OfficeConversionBanner node={node} />
      {notice && <p role="alert" className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive sm:px-6">{notice}</p>}
      <div className={previewFillsView(filePreviewKind(node)) ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-auto bg-muted/20 p-4'}>
        {/* Large files are not rendered on every open, as other previews are not downloaded. */}
        {office.pdf && !filePreviewKind(node) && node.sizeBytes <= MAX_INLINE_PREVIEW_BYTES && !node.trashedAt ? <OfficePdfPreview node={node} /> : <FilePreviewBody node={node} />}
      </div>
    </div>
  )
}

function FileViewMessage({ message, view, back }: { message: string; view: FileViewContext; back: string }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md rounded-xl border p-6 text-center">
        <TriangleAlert className="mx-auto size-8 text-amber-500" />
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {view.layout === 'panel'
          ? <Button variant="outline" size="sm" className="mt-4" onClick={() => useSidePanel.getState().close()}>{ui("Close")}</Button>
          : <Button asChild variant="outline" size="sm" className="mt-4"><Link to={back}>{ui("Back to My files")}</Link></Button>}
      </div>
    </div>
  )
}

/**
 * Opens a file by what it is: documents in their format's editor, uploaded Markdown read-only
 * until converted, and anything else as a preview (uploaded text and code with an Edit button).
 */
function FileRoute({ userId, fileId, view }: { userId: string; fileId: string; view: FileViewContext }) {
  const nodeQuery = useQuery({ queryKey: fileNodeQueryKey(userId, fileId), queryFn: () => fetchFileNode(fileId) })
  // The side panel leaves the tab's title to the main view (a chat's title, say).
  return (
    <>
      {view.layout === 'page' && <PageTitle node={nodeQuery.data?.node} />}
      {fileRouteView(nodeQuery, userId, fileId, view)}
    </>
  )
}

function fileRouteView(nodeQuery: UseQueryResult<{ node: FileNode; ancestors: FileNode[] }>, userId: string, fileId: string, view: FileViewContext): ReactNode {
  if (nodeQuery.isPending) return <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  const node = nodeQuery.data?.node
  const back = node?.parentId ? `/files/f/${node.parentId}` : '/files'
  if (nodeQuery.isError || !node) return <FileViewMessage message={filesErrorMessage(nodeQuery.error)} view={view} back={back} />
  if (node.kind === 'folder') return <FileViewMessage message={ui("Folders open in the Files view.")} view={view} back={`/files/f/${node.id}`} />
  if (node.kind === 'doc') {
    const web = liveWebFormat(node)
    if (web) return <OpenLiveDoc key={`live:${fileId}`} userId={userId} docId={fileId} view={view} web={web} />
    // A format this build does not know yet (a newer server); Markdown otherwise.
    if (node.format && node.format !== 'markdown' && !liveFormat(node.format)) {
      return <FileViewMessage message={ui("This document needs a newer version of Pulpo. Reload to open it.")} view={view} back={back} />
    }
    return <OpenDoc key={`doc:${fileId}`} userId={userId} docId={fileId} view={view} />
  }
  const ancestors = nodeQuery.data.ancestors
  if (isMarkdownName(node.name)) return <MarkdownFileView key={`md:${fileId}`} node={node} ancestors={ancestors} view={view} />
  return <BlobFileView key={`blob:${fileId}`} node={node} ancestors={ancestors} view={view} />
}

export function FileDocPage() {
  const { docId: routeDocId } = useParams()
  const docId = routeDocId?.toLowerCase()
  const location = useLocation()
  const userId = useAuth((state) => state.user?.id)
  const filesEnabled = useAuth((state) => state.filesEnabled)
  const shown = useSidePanel((state) => state.content)
  // Opening the side panel's file full page moves it here instead of showing it twice.
  useEffect(() => {
    if (!locationIsCurrent(location)) return
    if (docId && shown?.kind === 'file' && shown.id.toLowerCase() === docId) useSidePanel.getState().close()
  }, [docId, location, shown])
  if (!filesEnabled) {
    return <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">{ui("Files are disabled by the administrator")}</div>
  }
  if (!userId || !docId) return null
  return <FileRoute key={docId} userId={userId} fileId={docId} view={PAGE_VIEW} />
}

/** The side panel's content: the same file views in a compact layout. */
export function FilePanelView({ fileId: requestedId }: { fileId: string }) {
  const fileId = requestedId.toLowerCase()
  const userId = useAuth((state) => state.user?.id)
  const { pathname } = useLocation()
  const view = useMemo<FileViewContext>(() => ({ layout: 'panel', panel: { kind: 'file', id: fileId } }), [fileId])
  // One socket has one room membership per document. Never mount a second session even for
  // the render before the page's effect closes a reopened panel (e.g. Cmd/Ctrl+\).
  if (!userId || pathname.toLowerCase() === `/files/d/${fileId}`) return null
  return <FileRoute key={fileId} userId={userId} fileId={fileId} view={view} />
}
