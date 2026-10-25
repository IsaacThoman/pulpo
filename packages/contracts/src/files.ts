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
 * `recording` items are voice recordings: takes of audio played one after another, each with
 * its transcript (see recordings.ts).
 */
export const fileNodeKindSchema = z.enum(['folder', 'doc', 'blob', 'chat', 'shortcut', 'recording'])
export const fileNodeStatusSchema = z.enum(['pending', 'ready'])

/**
 * Folders every account has at the top of My files. `chats` is the Sidebar folder: the sidebar
 * shows its contents (chats directly in it are the sidebar's unfiled list). `archive` is where
 * "Move to archive" puts things. System folders cannot be renamed, moved, trashed, or given an
 * icon, but can be given a color.
 */
export const fileSystemRoleSchema = z.enum(['chats', 'archive'])
export type FileSystemRole = z.infer<typeof fileSystemRoleSchema>

/** Colors a file or folder can be given; without one it keeps its kind's own color. */
export const FILE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'] as const
export const fileColorSchema = z.enum(FILE_COLORS)
export type FileColor = z.infer<typeof fileColorSchema>

/** Icons a file or folder can show instead of its kind's own. */
export const FILE_ICONS = [
  'star', 'heart', 'bookmark', 'flag', 'book', 'briefcase', 'code', 'music', 'image', 'camera',
  'film', 'graduation-cap', 'home', 'globe', 'lightbulb', 'flask', 'rocket', 'gamepad', 'shopping-cart', 'plane',
  'wallet', 'calendar', 'lock', 'users', 'sparkles', 'palette', 'pen', 'wrench', 'leaf', 'coffee',
] as const
export const fileIconSchema = z.enum(FILE_ICONS)
export type FileIcon = z.infer<typeof fileIconSchema>

export const fileNodeSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: fileNodeKindSchema,
  name: z.string(),
  status: fileNodeStatusSchema,
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  /** Uploaded bytes' checksum; unchanged by renames or moves. Older servers may omit it. */
  contentChecksum: z.string().nullable().optional(),
  revision: z.number().int().nonnegative(),
  trashedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  systemRole: fileSystemRoleSchema.nullable().optional(),
  color: fileColorSchema.nullable().optional(),
  icon: fileIconSchema.nullable().optional(),
  /**
   * Position among the folder's items, chats included: ascending, newest first on ties. While
   * pinned, the position in the sidebar's pinned list instead.
   */
  sortOrder: z.number().int().optional(),
  /** Listed under Pinned at the top of the sidebar (and not in its folder there); Files marks it. */
  pinned: z.boolean().optional(),
  /**
   * Set while the item is an agent's suggestion the owner has not accepted yet: it was created by
   * an agent working in Suggest mode, and rejecting the suggestion deletes it.
   */
  suggestion: z.object({ changeId: z.uuid() }).nullable().optional(),
  /** What a shortcut opens. `available` is false while the target is in the trash. */
  target: z.object({
    kind: z.enum(['folder', 'doc', 'blob', 'chat', 'recording']),
    id: z.uuid(),
    name: z.string(),
    mimeType: z.string().nullable(),
    systemRole: fileSystemRoleSchema.nullable(),
    color: fileColorSchema.nullable().optional(),
    icon: fileIconSchema.nullable().optional(),
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

export const FILE_IMPORT_URL_MAX_LENGTH = 2048

/** Imports a public web page as a document, fetched by the same providers as the agent's web_fetch. */
export const importFileUrlSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  url: z.string().trim().min(1).max(FILE_IMPORT_URL_MAX_LENGTH),
})

/** A file's or folder's color and icon; null puts back its kind's own. */
const fileAppearanceFields = {
  color: fileColorSchema.nullable().optional(),
  icon: fileIconSchema.nullable().optional(),
}

export const updateFileNodeSchema = z.object({
  name: fileNameSchema.optional(),
  parentId: z.uuid().nullable().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  ...fileAppearanceFields,
}).refine(
  (input) => [input.name, input.parentId, input.color, input.icon].some((value) => value !== undefined),
  { message: 'Nothing to update' },
)

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

/**
 * What the Trash goes by: clients show it as a built-in folder at the top of My files, though it is
 * not stored in Files. Its place there is kept with the other items' places.
 */
export const TRASH_FOLDER_ID = 'trash'

/** Changes to a folder's grid arrangement; a null position forgets that item's place. */
export const updateFileFolderLayoutSchema = z.object({
  folderId: z.uuid().nullable(),
  snapToGrid: z.boolean().optional(),
  positions: z.record(z.union([z.uuid(), z.literal(TRASH_FOLDER_ID)]), fileGridPositionSchema.nullable())
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
export type ImportFileUrl = z.input<typeof importFileUrlSchema>
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

/**
 * A folder of the Chats and Archive trees, for the sidebar's move menu, or of a pinned folder's
 * tree (whose top folder's parent may be missing from the list).
 */
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
  /**
   * Pinned folders, files, and shortcuts, wherever they are in Files; pinned chats come from the
   * chat list. They share one order with the pinned chats (`sortOrder`).
   */
  pinnedItems?: FileNode[]
}

export const createSidebarFolderSchema = z.object({
  /** Client-chosen id, so a folder created offline keeps its identity when replayed. */
  id: z.uuid().optional(),
  /** Defaults to the Chats folder. */
  parentId: z.uuid().nullable().optional(),
  name: fileNameSchema,
})

/** Renames a sidebar item or changes its color and icon. */
export const updateSidebarItemSchema = z.object({
  name: fileNameSchema.optional(),
  ...fileAppearanceFields,
}).refine((input) => Object.values(input).some((value) => value !== undefined), { message: 'Nothing to update' })

/**
 * Moves chats and Files items into a folder; null is the Chats folder (the top of the sidebar).
 * Pinned ones stay pinned unless `unpin` takes them out of the pinned list, as dragging them out
 * of it does.
 */
export const moveSidebarItemsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(FILE_BATCH_MAX_ITEMS),
  parentId: z.uuid().nullable(),
  unpin: z.boolean().optional(),
})

/**
 * The order of a folder's items, chats included; null is the Chats folder. Listed items from
 * other folders move in first.
 */
export const orderSidebarItemsSchema = z.object({
  parentId: z.uuid().nullable(),
  ids: z.array(z.uuid()).min(1).max(10_000),
})

/**
 * Pins chats and Files items, in this order after those already pinned, or unpins them, each back
 * to the top of its folder. Pinned items stay where they are in Files.
 */
export const pinSidebarItemsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(FILE_BATCH_MAX_ITEMS),
  pinned: z.boolean(),
})

/** The order of the sidebar's pinned list, chats included. Listed items not yet pinned are pinned. */
export const orderPinnedItemsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(10_000),
})

export const archiveItemsSchema = z.object({
  chatIds: z.array(z.uuid()).max(FILE_BATCH_MAX_ITEMS).default([]),
  fileIds: z.array(z.uuid()).max(FILE_BATCH_MAX_ITEMS).default([]),
}).refine((input) => input.chatIds.length + input.fileIds.length > 0, { message: 'Nothing to archive' })

export type CreateSidebarFolder = z.input<typeof createSidebarFolderSchema>
export type UpdateSidebarItem = z.infer<typeof updateSidebarItemSchema>
export type ArchiveItems = z.input<typeof archiveItemsSchema>
export type PinSidebarItems = z.input<typeof pinSidebarItemsSchema>

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

/**
 * What an agent may do with a Files item attached to a chat. `read`: look only. `suggest`: its
 * changes wait for the owner to accept or reject them (documents show them inline). `write`: its
 * changes apply right away and can be undone per reply.
 */
export const FILE_ACCESS_MODES = ['read', 'suggest', 'write'] as const
export const fileAccessModeSchema = z.enum(FILE_ACCESS_MODES)
export type FileAccessMode = z.infer<typeof fileAccessModeSchema>
export const DEFAULT_FILE_ACCESS_MODE: FileAccessMode = 'suggest'

/** The kinds of change an agent makes to Files. `update` is new content; `move` includes renames. */
export const fileChangeKindSchema = z.enum(['create', 'update', 'move', 'trash'])
export type FileChangeKind = z.infer<typeof fileChangeKindSchema>

/**
 * `applied`/`undone`: a Write-mode change and whether the reply's undo is in effect.
 * `pending`/`accepted`/`rejected`: a Suggest-mode change awaiting or after the owner's review.
 */
export const fileChangeStatusSchema = z.enum(['applied', 'undone', 'pending', 'accepted', 'rejected'])
export type FileChangeStatus = z.infer<typeof fileChangeStatusSchema>

/** One item an agent reply changed, as listed under that reply. */
export interface FileChangeSummary {
  id: string
  nodeId: string
  /** The item's current name; it may since have been renamed. */
  name: string
  nodeKind: 'folder' | 'doc' | 'blob' | 'recording'
  mimeType: string | null
  kind: FileChangeKind
  mode: 'write' | 'suggest'
  status: FileChangeStatus
  /** Unresolved inline suggestions, for a document changed in Suggest mode. */
  pendingSuggestions?: number
  /** For moves: where the item was and where it goes. Paths are from the top of My files. */
  fromPath?: string
  toPath?: string
  /** For new content of an uploaded file: the sizes before and after. */
  fromSizeBytes?: number
  toSizeBytes?: number
  /** False once the item is permanently deleted or the change expired. */
  available: boolean
}

export interface FileChangesResponse {
  changes: FileChangeSummary[]
  /** Every Write-mode change is applied and can be undone together. */
  canUndo: boolean
  /** Every Write-mode change is undone and can be redone together. */
  canRedo: boolean
}

/**
 * Why an undo or redo was refused: the item changed after the agent's reply. Documents carry
 * the Markdown the reply left (`expected`) and what is there now (`current`).
 */
export interface FileChangeConflict {
  changeId: string
  nodeId: string
  name: string
  kind: FileChangeKind
  reason: 'edited' | 'moved' | 'trashed' | 'deleted' | 'restored' | 'replaced'
  expected?: string
  current?: string
}

export interface FileChangeConflictBody {
  error: { code: 'file_changes_conflict'; message: string; conflicts: FileChangeConflict[] }
}

/** A reply's response item announcing it changed Files; the details come from the changes API. */
export interface FileChangesItem {
  type: 'pulpo_file_changes'
  id: string
  /** Items the reply changed so far. */
  count: number
}
