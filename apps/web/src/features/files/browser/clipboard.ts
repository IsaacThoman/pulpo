import type { FileNode } from '@pulpo/contracts'
import { create } from 'zustand'

export interface FileClipboard {
  mode: 'cut' | 'copy'
  nodes: FileNode[]
}

/** In-app clipboard for Files; it survives folder navigation but not a reload. */
export const useFileClipboard = create<{ clip: FileClipboard | null }>(() => ({ clip: null }))
