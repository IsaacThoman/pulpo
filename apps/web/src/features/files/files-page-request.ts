import { create } from 'zustand'

/** Something to do in My files once the Files page shows it, asked from outside the page. */
export type FilesPageRequest = { kind: 'newFile' } | { kind: 'newFolder' } | { kind: 'upload'; files: File[] }

export const useFilesPageRequest = create<{ request: FilesPageRequest | null }>()(() => ({ request: null }))
