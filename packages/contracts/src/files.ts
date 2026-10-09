import { z } from 'zod'

export const FILE_NAME_MAX_LENGTH = 255
/** Folder nesting limit; keeps ancestor walks and breadcrumbs bounded. */
export const FILE_TREE_MAX_DEPTH = 32

export type FileNameError = 'empty' | 'too_long' | 'reserved' | 'invalid_character'

export function normalizeFileName(value: string): string {
  return value.normalize('NFC').trim()
}

/** Validates an already-normalized name. Length counts code points, matching Postgres char_length. */
export function fileNameError(name: string): FileNameError | null {
  if (!name) return 'empty'
  if ([...name].length > FILE_NAME_MAX_LENGTH) return 'too_long'
  if (name === '.' || name === '..') return 'reserved'
  for (const character of name) {
    const code = character.charCodeAt(0)
    if (character === '/' || code < 0x20 || code === 0x7f) return 'invalid_character'
  }
  return null
}

export const fileNameSchema = z.string().max(4 * FILE_NAME_MAX_LENGTH).transform(normalizeFileName).superRefine((name, context) => {
  const error = fileNameError(name)
  if (error) context.addIssue({ code: 'custom', message: `Invalid file name (${error})` })
})

/**
 * Names ending in .md or .markdown are Markdown files: they open in the editor, either
 * already converted (`doc` nodes) or still holding their uploaded bytes (`blob` nodes).
 */
export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

function splitExtension(name: string): [base: string, extension: string] {
  const dot = name.lastIndexOf('.')
  // Dotfiles such as ".env" have no extension to preserve, and a very long "extension" is just text.
  return dot > 0 && name.length - dot <= 32 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

function truncateCodePoints(value: string, length: number): string {
  const points = [...value]
  return points.length > length ? points.slice(0, Math.max(0, length)).join('') : value
}

/**
 * Picks the first free Drive-style name ("Report (2).pdf") given the lowercase names already
 * used by live siblings. Suffixed names are truncated so they stay within the length limit.
 */
export function nextAvailableName(desired: string, takenLowercase: ReadonlySet<string>): string {
  if (!takenLowercase.has(desired.toLowerCase())) return desired
  const [base, extension] = splitExtension(desired)
  for (let index = 2; ; index += 1) {
    const suffix = ` (${index})${extension}`
    const candidate = truncateCodePoints(base, FILE_NAME_MAX_LENGTH - [...suffix].length) + suffix
    if (!takenLowercase.has(candidate.toLowerCase())) return candidate
  }
}

/**
 * `chat` items are chats filed in a folder. They are listed beside files and can be moved,
 * renamed, and trashed with them, but they live in the chats table, not the Files tree.
 * `shortcut` items open another item (a folder, file, or chat) from wherever they are placed.
 */
export const fileNodeKindSchema = z.enum(['folder', 'doc', 'blob', 'chat', 'shortcut'])
export const fileNodeStatusSchema = z.enum(['pending', 'ready'])

/**
 * Folders every account has at the top of My files. `chats` holds the sidebar's folders (chats
 * directly in it are the sidebar's unfiled list); `archive` is where "Move to archive" puts things.
 * System folders cannot be renamed, moved, or trashed.
 */
export const fileSystemRoleSchema = z.enum(['chats', 'archive'])
export type FileSystemRole = z.infer<typeof fileSystemRoleSchema>

export const fileNodeSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: fileNodeKindSchema,
  name: z.string(),
  status: fileNodeStatusSchema,
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  trashedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  systemRole: fileSystemRoleSchema.nullable().optional(),
  /** Position among the folder's items, chats included: ascending, newest first on ties. */
  sortOrder: z.number().int().optional(),
  /** What a shortcut opens. `available` is false while the target is in the trash. */
  target: z.object({
    kind: z.enum(['folder', 'doc', 'blob', 'chat']),
    id: z.uuid(),
    name: z.string(),
    mimeType: z.string().nullable(),
    systemRole: fileSystemRoleSchema.nullable(),
    available: z.boolean(),
  }).nullable().optional(),
})

export const createFileFolderSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  name: fileNameSchema,
})

export const FILE_DOC_MAX_MARKDOWN_LENGTH = 2_000_000

export const createFileDocSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  name: fileNameSchema.optional(),
  /** Initial content, e.g. when importing an uploaded .md file. */
  markdown: z.string().max(FILE_DOC_MAX_MARKDOWN_LENGTH).optional(),
})

export const updateFileNodeSchema = z.object({
  name: fileNameSchema.optional(),
  parentId: z.uuid().nullable().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
}).refine((input) => input.name !== undefined || input.parentId !== undefined, { message: 'Nothing to update' })

/** Upper bound on items in one batch request; a selection larger than this is split by the client. */
export const FILE_BATCH_MAX_ITEMS = 500
const fileIdsSchema = z.array(z.uuid()).min(1).max(FILE_BATCH_MAX_ITEMS)

export const fileNodeIdsSchema = z.object({ ids: fileIdsSchema })

export const moveFileNodesSchema = z.object({
  items: z.array(z.object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    /** Optional target name, e.g. when undoing a move that had to rename. */
    name: fileNameSchema.optional(),
  })).min(1).max(FILE_BATCH_MAX_ITEMS),
})

/**
 * Copies a chat attachment into Files, into `parentId` (null is My files). `name` defaults to the
 * attachment's; a taken name gets a ` (n)` suffix unless `replaceId` names the file to overwrite,
 * which then moves to the trash.
 */
export const saveAttachmentToFilesSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  name: fileNameSchema.optional(),
  replaceId: z.uuid().optional(),
})

export const copyFileNodesSchema = z.object({
  ids: fileIdsSchema,
  parentId: z.uuid().nullable(),
})

export const reserveFileUploadSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  name: fileNameSchema,
  mimeType: z.string().min(1).max(255),
  // The per-file cap is an admin setting enforced when the upload is reserved.
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})

/** Where an item sits in a folder's grid view, in pixels from the canvas's top-left corner. */
export const fileGridPositionSchema = z.object({
  x: z.number().int().min(0).max(1_000_000),
  y: z.number().int().min(0).max(1_000_000),
})

/** A folder's grid arrangement; `folderId` null is My files. */
export interface FileFolderLayout {
  folderId: string | null
  snapToGrid: boolean
  positions: Record<string, FileGridPosition>
}

/** Changes to a folder's grid arrangement; a null position forgets that item's place. */
export const updateFileFolderLayoutSchema = z.object({
  folderId: z.uuid().nullable(),
  snapToGrid: z.boolean().optional(),
  positions: z.record(z.uuid(), fileGridPositionSchema.nullable())
    .refine((positions) => Object.keys(positions).length <= 5_000, { message: 'Too many positions' })
    .optional(),
})

export type FileGridPosition = z.infer<typeof fileGridPositionSchema>
export type UpdateFileFolderLayout = z.input<typeof updateFileFolderLayoutSchema>
export type FileNodeKind = z.infer<typeof fileNodeKindSchema>
export type FileNode = z.infer<typeof fileNodeSchema>
export type CreateFileFolder = z.input<typeof createFileFolderSchema>
export type UpdateFileNode = z.input<typeof updateFileNodeSchema>
export type CreateFileDoc = z.input<typeof createFileDocSchema>
export type ReserveFileUpload = z.input<typeof reserveFileUploadSchema>
export type MoveFileNodes = z.input<typeof moveFileNodesSchema>

export interface FileListing {
  /** Null for the root of the account's Files tree. */
  folder: FileNode | null
  /** Root-first ancestors of `folder`, excluding the folder itself. */
  ancestors: FileNode[]
  children: FileNode[]
}

/** A shortcut to a Files item or a chat, placed in `parentId` (null is My files; omitted, the Chats folder). */
export const createShortcutSchema = z.object({
  targetKind: z.enum(['file', 'chat']),
  targetId: z.uuid(),
  parentId: z.uuid().nullable().optional(),
  name: fileNameSchema.optional(),
})
export type CreateShortcut = z.input<typeof createShortcutSchema>

/** A folder of the Chats and Archive trees, for the sidebar's move menu. */
export interface SidebarFolder {
  id: string
  parentId: string | null
  name: string
  systemRole: FileSystemRole | null
}

export interface SidebarState {
  chatsFolderId: string
  archiveFolderId: string
  folders: SidebarFolder[]
}

export const createSidebarFolderSchema = z.object({
  /** Client-chosen id, so a folder created offline keeps its identity when replayed. */
  id: z.uuid().optional(),
  /** Defaults to the Chats folder. */
  parentId: z.uuid().nullable().optional(),
  name: fileNameSchema,
})

export const renameSidebarItemSchema = z.object({ name: fileNameSchema })

/** Moves chats and Files items into a folder; null is the Chats folder (the top of the sidebar). */
export const moveSidebarItemsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(FILE_BATCH_MAX_ITEMS),
  parentId: z.uuid().nullable(),
})

/**
 * The order of a folder's items, chats included; null is the Chats folder. Listed items from
 * other folders move in first.
 */
export const orderSidebarItemsSchema = z.object({
  parentId: z.uuid().nullable(),
  ids: z.array(z.uuid()).min(1).max(10_000),
})

export const archiveItemsSchema = z.object({
  chatIds: z.array(z.uuid()).max(FILE_BATCH_MAX_ITEMS).default([]),
  fileIds: z.array(z.uuid()).max(FILE_BATCH_MAX_ITEMS).default([]),
}).refine((input) => input.chatIds.length + input.fileIds.length > 0, { message: 'Nothing to archive' })

export type CreateSidebarFolder = z.input<typeof createSidebarFolderSchema>
export type ArchiveItems = z.input<typeof archiveItemsSchema>

export interface FileUploadReservation {
  node: FileNode
  uploadUrl: string
  uploadHeaders: Record<string, string>
}

export type DocSyncError =
  | 'not_found'
  | 'unauthorized'
  | 'schema_outdated'
  | 'doc_too_large'
  | 'invalid_update'
  | 'rate_limited'
  | 'failed'

export interface DocJoinInput {
  docId: string
  /** Yjs state vector of the client's copy; the server replies with what the client is missing. */
  stateVector: Uint8Array
  /** The client's awareness clientID, so the server can clear its cursor when the socket leaves. */
  awarenessClientId: number
  schemaVersion: number
}

export type DocJoinResult =
  | { ok: true; update: Uint8Array; stateVector: Uint8Array }
  | { ok: false; error: DocSyncError }

export type DocAck = { ok: true } | { ok: false; error: DocSyncError }

export interface DocUpdateMessage {
  docId: string
  update: Uint8Array
}

export interface DocClosedEvent {
  docId: string
  /** `converted`: renamed to a non-Markdown name, so it became an ordinary file. */
  reason: 'trashed' | 'deleted' | 'converted'
}

/** Dry run of turning an uploaded Markdown file into an editable document. */
export interface FileConversionPreview {
  original: string
  converted: string
  /** False when only line endings or trailing whitespace would change. */
  changed: boolean
}
