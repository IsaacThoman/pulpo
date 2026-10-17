import { isMarkdownName, type FileNode } from '@pulpo/contracts'
import {
  File as FileIconGlyph,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  ArrowUpRight,
  FolderArchive,
  MessageSquare,
  PanelLeft,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TRASH_FOLDER_ID } from '@/features/trash/folder'
import { FILE_COLOR_CLASSES, FILE_ICON_GLYPHS } from './appearance'
import { ARCHIVE_EXTENSIONS, CODE_EXTENSIONS, fileExtension, SHEET_EXTENSIONS } from './file-display'

type IconNode = Pick<FileNode, 'kind' | 'name' | 'mimeType'> & Partial<Pick<FileNode, 'id' | 'systemRole' | 'target' | 'color' | 'icon'>>

/** A shortcut looks like what it opens, with an arrow in the corner as on a desktop. */
export function FileNodeIcon({ node, className }: { node: IconNode; className?: string }) {
  if (node.kind !== 'shortcut') return <ItemIcon node={node} className={className} />
  const target = node.target
  return (
    <span className={cn('relative inline-grid shrink-0', className, !target?.available && 'opacity-60')}>
      <ItemIcon
        node={target
          ? { kind: target.kind, name: target.name, mimeType: target.mimeType, systemRole: target.systemRole, color: target.color, icon: target.icon }
          : { kind: 'blob', name: node.name, mimeType: null }}
        className="size-full"
      />
      <span aria-hidden className="absolute -bottom-0.5 -left-0.5 grid size-[45%] min-h-2.5 min-w-2.5 place-items-center rounded-[2px] bg-background ring-1 ring-border">
        <ArrowUpRight className="size-full text-foreground" strokeWidth={3} />
      </span>
    </span>
  )
}

const FOLDER_COLORS = 'fill-muted-foreground/15 text-muted-foreground'

function ItemIcon({ node, className }: { node: IconNode; className?: string }) {
  const classes = cn('shrink-0', className)
  if (node.kind === 'chat') return <MessageSquare className={cn(classes, 'text-sky-500')} />
  // A chosen color replaces the kind's own; a chosen icon replaces its glyph.
  const tint = node.color ? FILE_COLOR_CLASSES[node.color] : null
  // Built-in folders keep their icons. The Sidebar folder shows the sidebar itself, the mirror of
  // "Open to the right".
  if (node.kind === 'folder' && node.systemRole === 'chats') return <PanelLeft className={cn(classes, tint ? [tint.text, tint.fill] : FOLDER_COLORS)} />
  if (node.kind === 'folder' && node.systemRole === 'archive') return <FolderArchive className={cn(classes, tint ? [tint.text, tint.fill] : FOLDER_COLORS)} />
  if (node.kind === 'folder' && node.id === TRASH_FOLDER_ID) return <Trash2 className={cn(classes, tint ? [tint.text, tint.fill] : FOLDER_COLORS)} />
  if (node.icon) {
    const Glyph = FILE_ICON_GLYPHS[node.icon]
    return <Glyph className={cn(classes, tint?.text ?? 'text-muted-foreground')} />
  }
  if (node.kind === 'folder') return <Folder className={cn(classes, tint ? [tint.text, tint.fill] : FOLDER_COLORS)} />
  const [Glyph, color] = fileGlyph(node)
  return <Glyph className={cn(classes, tint?.text ?? color)} />
}

/** A file's glyph and color from its type: the extension decides, then the MIME type. */
function fileGlyph(node: IconNode): [LucideIcon, string] {
  // Markdown looks the same before and after it becomes editable.
  if (isMarkdownName(node.name)) return [FileText, 'text-muted-foreground']
  const mime = (node.mimeType ?? '').toLowerCase()
  const extension = fileExtension(node.name)
  if (mime.startsWith('image/')) return [FileImage, 'text-rose-500']
  if (mime.startsWith('video/')) return [FileVideo, 'text-violet-500']
  if (mime.startsWith('audio/')) return [FileAudio, 'text-amber-500']
  if (mime === 'application/pdf' || extension === 'pdf') return [FileText, 'text-red-500']
  if (SHEET_EXTENSIONS.has(extension)) return [FileSpreadsheet, 'text-emerald-600']
  if (ARCHIVE_EXTENSIONS.has(extension)) return [FileArchive, 'text-muted-foreground']
  if (CODE_EXTENSIONS.has(extension)) return [FileCode, 'text-muted-foreground']
  if (extension === 'md' || mime.startsWith('text/')) return [FileText, 'text-muted-foreground']
  return [FileIconGlyph, 'text-muted-foreground']
}
