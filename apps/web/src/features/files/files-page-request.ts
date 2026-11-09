import { create } from 'zustand'

/** Something to do in My files (or an upload's folder) once the Files page shows it, asked from outside the page. */
export type FilesPageRequest = { kind: 'newFile' } | { kind: 'newFolder' } | { kind: 'importUrl' }
  /** Uploads into `folderId` (My files when missing), once the page shows that folder. */
  | { kind: 'upload'; files: File[]; folderId?: string | null }

export const useFilesPageRequest = create<{ request: FilesPageRequest | null }>()(() => ({ request: null }))
