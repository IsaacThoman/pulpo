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

export const fileNodeKindSchema = z.enum(['folder', 'doc', 'blob'])
export const fileNodeStatusSchema = z.enum(['pending', 'ready'])

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
})

export const createFileFolderSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  name: fileNameSchema,
})

export const updateFileNodeSchema = z.object({
  name: fileNameSchema.optional(),
  parentId: z.uuid().nullable().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
}).refine((input) => input.name !== undefined || input.parentId !== undefined, { message: 'Nothing to update' })

export const reserveFileUploadSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  name: fileNameSchema,
  mimeType: z.string().min(1).max(255),
  // The per-file cap is an admin setting enforced when the upload is reserved.
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})

export type FileNodeKind = z.infer<typeof fileNodeKindSchema>
export type FileNode = z.infer<typeof fileNodeSchema>
export type CreateFileFolder = z.input<typeof createFileFolderSchema>
export type UpdateFileNode = z.input<typeof updateFileNodeSchema>
export type ReserveFileUpload = z.input<typeof reserveFileUploadSchema>

export interface FileListing {
  /** Null for the root of the account's Files tree. */
  folder: FileNode | null
  /** Root-first ancestors of `folder`, excluding the folder itself. */
  ancestors: FileNode[]
  children: FileNode[]
}

export interface FileUploadReservation {
  node: FileNode
  uploadUrl: string
  uploadHeaders: Record<string, string>
}
