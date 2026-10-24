import { isMarkdownName, type FileNameError, type FileNode } from '@pulpo/contracts'
import { ApiError } from '@/lib/api'
import { ui, uit } from '@/i18n/ui'

export {
  ARCHIVE_EXTENSIONS,
  CODE_EXTENSIONS,
  fileExtension,
  filePreviewKind,
  MAX_INLINE_PREVIEW_BYTES,
  MAX_TEXT_PREVIEW_BYTES,
  SHEET_EXTENSIONS,
  type FilePreviewKind,
} from '@pulpo/client-core/files'
import { fileExtension } from '@pulpo/client-core/files'

/** The folder items dropped on `node` go into: the folder itself, or the folder a shortcut opens. */
export function dropFolderOf(node: FileNode): string | undefined {
  if (node.kind === 'folder') return node.id
  if (node.kind === 'shortcut' && node.target?.kind === 'folder' && node.target.available) return node.target.id
  return undefined
}

/** Short type description for the Kind column. */
export function fileKindLabel(node: Pick<FileNode, 'kind' | 'name'>): string {
  if (node.kind === 'folder') return ui("Folder")
  if (node.kind === 'chat') return ui("Chat")
  if (node.kind === 'shortcut') return ui("Shortcut")
  // The extension alone decides the type, whether or not the file is editable yet.
  if (isMarkdownName(node.name)) return ui("Markdown")
  const extension = fileExtension(node.name)
  return extension ? extension.toUpperCase() : ui("File")
}

export function fileNameErrorMessage(error: FileNameError): string {
  switch (error) {
    case 'empty': return ui("Name is required")
    case 'too_long': return ui("Names can be at most 255 characters")
    case 'reserved': return ui("This name is reserved")
    case 'invalid_character': return ui("Names cannot contain \"/\" or control characters")
  }
}

/** Translates the Files API's known failures; anything else keeps the server's message. */
export function filesErrorMessage(error: unknown, name?: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'file_name_conflict': return name ? uit`An item named "${name}" already exists here` : ui("An item with this name already exists here")
      case 'file_name_empty':
      case 'file_name_too_long':
      case 'file_name_reserved':
      case 'file_name_invalid_character':
        return fileNameErrorMessage(error.code.slice('file_name_'.length) as FileNameError)
      case 'file_replace_conflict': return ui("The file to overwrite has changed. Try saving again.")
      case 'file_move_cycle': return ui("A folder cannot be moved into itself")
      case 'file_tree_too_deep': return ui("Folders can be nested at most 32 levels deep")
      case 'file_revision_conflict': return ui("This item changed on another device. Refresh and try again.")
      case 'storage_quota_exceeded': return ui("This file would exceed your storage allowance")
      case 'files_disabled': return ui("Files are disabled by the administrator")
      case 'file_too_large_to_edit': return ui("This file is too large to edit")
      case 'file_not_text': return ui("This file isn't plain text, so it can't be edited")
      case 'file_not_markdown': return ui("Only .md and .markdown files can be edited")
      case 'not_found': return ui("This item no longer exists")
      case 'file_system_folder': return ui("This folder is built in and cannot be renamed, moved, trashed, or recolored")
      case 'file_chat_copy': return ui("Chats cannot be copied here; duplicate them from the chat menu")
      case 'url_import_invalid': return ui("Enter a full web address, like https://example.com")
      case 'url_import_not_https': return ui("Only https:// links can be imported")
      case 'url_import_credentials': return ui("Links with a username or password cannot be imported")
      case 'url_import_failed': return ui("This page could not be imported. Check the link and try again.")
      case 'url_import_unavailable': return ui("Importing from a URL is not available")
      case 'file_shortcut_to_shortcut': return ui("Create a shortcut to the item this shortcut opens instead")
      default: return error.message
    }
  }
  return error instanceof Error ? error.message : ui("Something went wrong")
}
