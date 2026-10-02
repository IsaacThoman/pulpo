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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ARCHIVE_EXTENSIONS, CODE_EXTENSIONS, fileExtension, SHEET_EXTENSIONS } from './file-display'

export function FileNodeIcon({ node, className }: { node: Pick<FileNode, 'kind' | 'name' | 'mimeType'>; className?: string }) {
  const classes = cn('shrink-0', className)
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
