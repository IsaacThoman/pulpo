import type { FileColor, FileIcon, FileNode } from '@pulpo/contracts'
import { isMarkdownName } from '@pulpo/contracts'
import { ARCHIVE_EXTENSIONS, CODE_EXTENSIONS, fileExtension, SHEET_EXTENSIONS } from '@pulpo/client-core/files'
import { ApiError, isNetworkError } from '../../api/client'

/** The iOS system colors behind each Files color. */
export const FILE_COLOR_HEX: Record<FileColor, string> = {
  red: '#FF3B30',
  orange: '#FF9500',
  yellow: '#FFCC00',
  green: '#34C759',
  teal: '#30B0C7',
  blue: '#007AFF',
  purple: '#AF52DE',
  pink: '#FF2D55',
  gray: '#8E8E93',
}

/** SF Symbols for the icons an item can be given (the web uses Lucide's of the same names). */
const ICON_SYMBOLS: Record<FileIcon, string> = {
  star: 'star.fill',
  heart: 'heart.fill',
  bookmark: 'bookmark.fill',
  flag: 'flag.fill',
  book: 'book.fill',
  briefcase: 'briefcase.fill',
  code: 'chevron.left.forwardslash.chevron.right',
  music: 'music.note',
  image: 'photo.fill',
  camera: 'camera.fill',
  film: 'film.fill',
  'graduation-cap': 'graduationcap.fill',
  home: 'house.fill',
  globe: 'globe',
  lightbulb: 'lightbulb.fill',
  flask: 'flask.fill',
  rocket: 'paperplane.fill',
  gamepad: 'gamecontroller.fill',
  'shopping-cart': 'cart.fill',
  plane: 'airplane',
  wallet: 'wallet.bifold.fill',
  calendar: 'calendar',
  lock: 'lock.fill',
  users: 'person.2.fill',
  sparkles: 'sparkles',
  palette: 'paintpalette.fill',
  pen: 'pencil',
  wrench: 'wrench.fill',
  leaf: 'leaf.fill',
  coffee: 'cup.and.saucer.fill',
}

type IconSubject = Pick<FileNode, 'kind' | 'name' | 'mimeType'> & Partial<Pick<FileNode, 'systemRole' | 'color' | 'icon' | 'target'>>

/** The kind an item opens as: a shortcut takes its target's. */
export function openedKind(node: Pick<FileNode, 'kind' | 'target'>): FileNode['kind'] {
  return node.kind === 'shortcut' ? node.target?.kind ?? 'blob' : node.kind
}

/** iOS system blue, which folders and documents use unless given a color. */
const SYSTEM_BLUE = '#0A84FF'

/** An item's symbol and color, as on the web: custom icon and color first, then its kind's. */
export function fileIcon(node: IconSubject, fallbackTint = SYSTEM_BLUE): { symbol: string; tint: string } {
  const source = node.kind === 'shortcut' && node.target
    ? { ...node.target, color: node.color ?? node.target.color, icon: node.icon ?? node.target.icon }
    : node
  const tint = source.color ? FILE_COLOR_HEX[source.color] : null
  if (source.icon) return { symbol: ICON_SYMBOLS[source.icon], tint: tint ?? fallbackTint }
  const kind = source.kind
  if (kind === 'folder') {
    if (source.systemRole === 'chats') return { symbol: 'bubble.left.and.bubble.right.fill', tint: tint ?? fallbackTint }
    if (source.systemRole === 'archive') return { symbol: 'archivebox.fill', tint: tint ?? fallbackTint }
    return { symbol: 'folder.fill', tint: tint ?? fallbackTint }
  }
  if (kind === 'chat') return { symbol: 'bubble.left.fill', tint: tint ?? '#8E8E93' }
  if (kind === 'doc') return { symbol: 'doc.text.fill', tint: tint ?? SYSTEM_BLUE }
  const mime = (source.mimeType ?? '').toLowerCase()
  const extension = fileExtension(source.name)
  if (mime.startsWith('image/')) return { symbol: 'photo.fill', tint: tint ?? '#34C759' }
  if (mime.startsWith('video/')) return { symbol: 'film.fill', tint: tint ?? '#AF52DE' }
  if (mime.startsWith('audio/')) return { symbol: 'waveform', tint: tint ?? '#FF2D55' }
  if (mime === 'application/pdf' || extension === 'pdf') return { symbol: 'doc.fill', tint: tint ?? '#FF3B30' }
  if (isMarkdownName(source.name)) return { symbol: 'doc.plaintext.fill', tint: tint ?? '#8E8E93' }
  if (ARCHIVE_EXTENSIONS.has(extension)) return { symbol: 'doc.zipper', tint: tint ?? '#8E8E93' }
  if (SHEET_EXTENSIONS.has(extension)) return { symbol: 'tablecells.fill', tint: tint ?? '#34C759' }
  if (CODE_EXTENSIONS.has(extension)) return { symbol: 'chevron.left.forwardslash.chevron.right', tint: tint ?? '#5856D6' }
  return { symbol: 'doc.fill', tint: tint ?? '#8E8E93' }
}

export function fileKindLabel(node: Pick<FileNode, 'kind' | 'name' | 'target'>): string {
  if (node.kind === 'folder') return 'Folder'
  if (node.kind === 'chat') return 'Chat'
  if (node.kind === 'shortcut') return `Shortcut to ${node.target?.name ?? 'an item'}`
  if (node.kind === 'doc') return 'Document'
  if (isMarkdownName(node.name)) return 'Markdown'
  const extension = fileExtension(node.name)
  return extension ? `${extension.toUpperCase()} file` : 'File'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} bytes`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1_000
  let unit = 0
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000
    unit += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`
}

/** "Today at 9:41 AM", "Yesterday at 9:41 AM", "Mar 3", or "Mar 3, 2025". */
export function formatModified(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' ')
  if (sameDay(date, now)) return `Today at ${time}`
  if (sameDay(date, yesterday)) return `Yesterday at ${time}`
  return date.toLocaleDateString(undefined, date.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The line under an item's name in a list. */
export function fileSubtitle(node: FileNode): string {
  if (node.kind === 'shortcut') return node.target?.available === false ? 'Shortcut · In the trash' : fileKindLabel(node)
  const modified = formatModified(node.updatedAt)
  if (node.kind === 'folder' || node.kind === 'chat') return modified
  if (node.status === 'pending') return 'Uploading…'
  return [modified, node.kind === 'blob' ? formatBytes(node.sizeBytes) : null].filter(Boolean).join(' · ')
}

/** Built-in folders cannot be renamed, moved, or trashed. */
export function isBuiltIn(node: Pick<FileNode, 'systemRole'>): boolean {
  return Boolean(node.systemRole)
}

/** The Files API's known failures in words; anything else keeps the server's message. */
export function filesErrorMessage(error: unknown, name?: string): string {
  if (isNetworkError(error)) return 'You’re offline. Try again when you’re connected.'
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'file_name_conflict': return name ? `An item named “${name}” already exists here.` : 'An item with this name already exists here.'
      case 'file_name_empty': return 'Name is required.'
      case 'file_name_too_long': return 'Names can be at most 255 characters.'
      case 'file_name_reserved': return 'This name is reserved.'
      case 'file_name_invalid_character': return 'Names can’t contain “/” or control characters.'
      case 'file_replace_conflict': return 'The file to overwrite has changed. Try saving again.'
      case 'file_move_cycle': return 'A folder can’t be moved into itself.'
      case 'file_tree_too_deep': return 'Folders can be nested at most 32 levels deep.'
      case 'file_revision_conflict': return 'This item changed on another device. Refresh and try again.'
      case 'storage_quota_exceeded': return 'This would exceed your storage allowance.'
      case 'files_disabled': return 'Files are turned off by your administrator.'
      case 'file_too_large_to_edit': return 'This file is too large to edit.'
      case 'file_not_text': return 'This file isn’t plain text, so it can’t be edited.'
      case 'file_not_markdown': return 'Only .md and .markdown files can be edited.'
      case 'not_found': return 'This item no longer exists.'
      case 'file_system_folder': return 'Built-in folders can’t be renamed, moved, or trashed.'
      case 'file_chat_copy': return 'Chats can’t be copied here. Duplicate them from the chat menu.'
      case 'file_shortcut_to_shortcut': return 'Create a shortcut to the item this shortcut opens instead.'
      default: return error.message
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}
