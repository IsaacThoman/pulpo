import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HardDrive, X } from 'lucide-react'
import { attachmentQueryKey, fetchAttachment } from '@/components/chat/attachment-actions'
import { fetchFileNode, fileNodeQueryKey } from '@/features/files/api'
import { FileNodeIcon } from '@/features/files/FileNodeIcon'
import { trashFolderNode, trashLocation } from '@/features/trash/folder'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { samePanelContent, serializePanelContent, useSidePanel, type PanelContent } from './store'

type TabLabel = { name: string; icon: ReactNode }

const ICON = 'size-3.5'

/** A tab's name and icon, from the queries its view already uses, so they are usually cached. */
function useTabLabel(content: PanelContent): TabLabel {
  const userId = useAuth((state) => state.user?.id)
  const trashColor = useSettings((state) => state.trashColor)
  const trash = content.kind === 'folder' ? trashLocation(content.id) : null
  // The node behind the tab: a file, a folder, or a trashed folder. My files and the trash have none.
  const nodeId = content.kind === 'file' ? content.id : content.kind === 'folder' ? (trash ? trash.folderId : content.id) : null
  const node = useQuery({
    queryKey: fileNodeQueryKey(userId, nodeId ?? ''),
    queryFn: () => fetchFileNode(nodeId!),
    enabled: Boolean(userId && nodeId),
  }).data?.node
  const attachment = useQuery({
    queryKey: attachmentQueryKey(userId, content.id ?? ''),
    queryFn: () => fetchAttachment(content.id!),
    enabled: Boolean(userId && content.kind === 'attachment'),
  }).data

  if (content.kind === 'attachment') {
    const name = attachment?.name ?? ui("Attachment")
    return { name, icon: <FileNodeIcon node={{ kind: 'blob', name, mimeType: attachment?.mimeType ?? null }} className={ICON} /> }
  }
  if (content.kind === 'folder' && content.id === null) return { name: ui("My files"), icon: <HardDrive className={cn(ICON, 'shrink-0 text-muted-foreground')} /> }
  if (trash && (!trash.folderId || !node)) {
    return { name: ui("Trash"), icon: <FileNodeIcon node={trashFolderNode(ui("Trash"), trashColor)} className={ICON} /> }
  }
  if (node) return { name: node.name, icon: <FileNodeIcon node={node} className={ICON} /> }
  return {
    name: content.kind === 'file' ? ui("File") : ui("Folder"),
    icon: <FileNodeIcon node={{ kind: content.kind === 'file' ? 'blob' : 'folder', name: '', mimeType: null }} className={ICON} />,
  }
}

function PanelTab({ content, active, onKeyDown }: { content: PanelContent; active: boolean; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void }) {
  const { name, icon } = useTabLabel(content)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => useSidePanel.getState().closeTab(content)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={name}
      data-panel-tab={serializePanelContent(content)}
      onClick={() => useSidePanel.getState().open(content)}
      // A middle click closes a tab, as in browsers and editors.
      onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
      onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close() } }}
      onKeyDown={onKeyDown}
      className={cn(
        // Tabs share the strip evenly, up to a maximum and down to a minimum width, then it scrolls.
        'group relative flex max-w-44 min-w-16 flex-1 basis-0 cursor-default items-center gap-1 border-r border-b pr-0.5 pl-2 text-xs select-none',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        // The tab in view joins the content below it.
        active ? 'border-b-transparent bg-background font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{name}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={ui("Close tab")}
        onClick={(event) => { event.stopPropagation(); close() }}
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground',
          // Touch screens have no hover, so their buttons stay visible.
          !active && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/**
 * The side panel's open files, folders, and attachments, as a thin strip above the one in view.
 * It shows once there is more than one; a single tab is just the panel.
 */
export function PanelTabs() {
  const tabs = useSidePanel((state) => state.tabs)
  const active = useSidePanel((state) => state.content)
  const listRef = useRef<HTMLDivElement>(null)
  if (tabs.length < 2) return null

  // Arrow keys move between tabs and show them; Delete closes the focused one.
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const store = useSidePanel.getState()
    if (step) {
      event.preventDefault()
      const next = tabs[(index + step + tabs.length) % tabs.length]!
      store.open(next)
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-panel-tab="${serializePanelContent(next)}"]`)?.focus())
    } else if (event.key === 'Delete') {
      event.preventDefault()
      store.closeTab(tabs[index]!)
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ui("Side panel tabs")}
      className="side-panel-tabs flex h-7 shrink-0 items-stretch overflow-x-auto overflow-y-hidden bg-muted/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab, index) => (
        <PanelTab key={serializePanelContent(tab)} content={tab} active={samePanelContent(tab, active)} onKeyDown={onKeyDown(index)} />
      ))}
      {/* The rest of the strip's bottom edge; the tab in view leaves a gap in it. */}
      <div aria-hidden className="min-w-2 grow-[0.001] border-b" />
    </div>
  )
}
