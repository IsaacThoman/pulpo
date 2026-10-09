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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ARCHIVE_EXTENSIONS, CODE_EXTENSIONS, fileExtension, SHEET_EXTENSIONS } from './file-display'

type IconNode = Pick<FileNode, 'kind' | 'name' | 'mimeType'> & Partial<Pick<FileNode, 'systemRole' | 'target'>>

/** A shortcut looks like what it opens, with an arrow in the corner as on a desktop. */
export function FileNodeIcon({ node, className }: { node: IconNode; className?: string }) {
  if (node.kind !== 'shortcut') return <ItemIcon node={node} className={className} />
  const target = node.target
  return (
    <span className={cn('relative inline-grid shrink-0', className, !target?.available && 'opacity-60')}>
      <ItemIcon node={target ? { kind: target.kind, name: target.name, mimeType: target.mimeType, systemRole: target.systemRole } : { kind: 'blob', name: node.name, mimeType: null }} className="size-full" />
      <span aria-hidden className="absolute -bottom-0.5 -left-0.5 grid size-[45%] min-h-2.5 min-w-2.5 place-items-center rounded-[2px] bg-background ring-1 ring-border">
        <ArrowUpRight className="size-full text-foreground" strokeWidth={3} />
      </span>
    </span>
  )
}

function ItemIcon({ node, className }: { node: IconNode; className?: string }) {
  const classes = cn('shrink-0', className)
  if (node.kind === 'chat') return <MessageSquare className={cn(classes, 'text-sky-500')} />
  if (node.kind === 'folder' && node.systemRole === 'archive') return <FolderArchive className={cn(classes, 'fill-muted-foreground/15 text-muted-foreground')} />
  if (node.kind === 'folder') return <Folder className={cn(classes, 'fill-muted-foreground/15 text-muted-foreground')} />
  // The extension decides the icon; Markdown looks the same before and after it becomes editable.
  if (isMarkdownName(node.name)) return <FileText className={cn(classes, 'text-muted-foreground')} />
  const mime = (node.mimeType ?? '').toLowerCase()
  const extension = fileExtension(node.name)
  if (mime.startsWith('image/')) return <FileImage className={cn(classes, 'text-rose-500')} />
  if (mime.startsWith('video/')) return <FileVideo className={cn(classes, 'text-violet-500')} />
  if (mime.startsWith('audio/')) return <FileAudio className={cn(classes, 'text-amber-500')} />
  if (mime === 'application/pdf' || extension === 'pdf') return <FileText className={cn(classes, 'text-red-500')} />
  if (SHEET_EXTENSIONS.has(extension)) return <FileSpreadsheet className={cn(classes, 'text-emerald-600')} />
  if (ARCHIVE_EXTENSIONS.has(extension)) return <FileArchive className={cn(classes, 'text-muted-foreground')} />
  if (CODE_EXTENSIONS.has(extension)) return <FileCode className={cn(classes, 'text-muted-foreground')} />
  if (extension === 'md' || mime.startsWith('text/')) return <FileText className={cn(classes, 'text-muted-foreground')} />
  return <FileIconGlyph className={cn(classes, 'text-muted-foreground')} />
}
