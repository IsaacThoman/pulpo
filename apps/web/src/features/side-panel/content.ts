import { trashFolderRef } from '@/features/trash/folder'

/**
 * What the side panel shows: a file, a folder of the Files browser (`null` is My files; the trash
 * and trashed folders use the references in features/trash/folder), or a chat attachment. Chats always live in the main view; the panel holds what they work on.
 */
export type PanelContent =
  | { kind: 'file'; id: string }
  | { kind: 'folder'; id: string | null }
  | { kind: 'attachment'; id: string }

export function samePanelContent(left: PanelContent | null, right: PanelContent | null): boolean {
  return serializePanelContent(left) === serializePanelContent(right)
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export function serializePanelContent(content: PanelContent | null): string | null {
  if (!content) return null
  if (content.kind === 'file') return `file:${content.id}`
  if (content.kind === 'attachment') return `attachment:${content.id}`
  return `folder:${content.id ?? 'root'}`
}

export function parsePanelContent(value: string | null): PanelContent | null {
  if (!value) return null
  const lower = value.toLowerCase()
  const file = new RegExp(`^file:(${UUID})$`).exec(lower)
  if (file) return { kind: 'file', id: file[1]! }
  const attachment = new RegExp(`^attachment:(${UUID})$`).exec(lower)
  if (attachment) return { kind: 'attachment', id: attachment[1]! }
  const folder = new RegExp(`^folder:(root|trash|trash:${UUID}|${UUID})$`).exec(lower)
  if (folder) return { kind: 'folder', id: folder[1] === 'root' ? null : folder[1]! }
  return null
}

/** What the main view shows, when it is something the panel can also show. */
export function mainViewContent(pathname: string): PanelContent | null {
  const file = /^\/files\/d\/([0-9a-f-]{36})$/i.exec(pathname)
  if (file) return { kind: 'file', id: file[1]!.toLowerCase() }
  const attachment = /^\/attachments\/([0-9a-f-]{36})$/i.exec(pathname)
  if (attachment) return { kind: 'attachment', id: attachment[1]!.toLowerCase() }
  const folder = /^\/files\/f\/([0-9a-f-]{36})$/i.exec(pathname)
  if (folder) return { kind: 'folder', id: folder[1]!.toLowerCase() }
  if (pathname === '/files') return { kind: 'folder', id: null }
  if (pathname === '/files/trash') return { kind: 'folder', id: trashFolderRef(null) }
  const trashed = /^\/files\/trash\/f\/([0-9a-f-]{36})$/i.exec(pathname)
  if (trashed) return { kind: 'folder', id: trashFolderRef(trashed[1]!.toLowerCase()) }
  return null
}

/**
 * Whether the main view at `pathname` (the current page by default) shows this file or
 * attachment: one of those is open in one view at a time. A folder can show in both.
 */
export function mainViewShows(content: PanelContent, pathname = typeof window === 'undefined' ? '' : window.location.pathname): boolean {
  return content.kind !== 'folder' && samePanelContent(mainViewContent(pathname), content)
}
