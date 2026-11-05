import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { liveFormat, SHEET_FORMAT, TEXT_FORMAT, type LiveAssetStore, type LiveFormatInfo } from '@pulpo/client-core/office'
import type { FileNode } from '@pulpo/contracts'
import { FileCode, FileSpreadsheet, type LucideIcon } from 'lucide-react'
import type * as Y from 'yjs'
import { ui } from '@/i18n/ui'
import { FileVersionsSummary } from './FileVersionsSummary'
import type { LiveDiffProps, LiveEditorProps } from './types'

/**
 * How the web app shows each live format other than Markdown (which keeps its own editor and
 * conversion dialog in FileDocPage). Adding a format here (with its catalog entry and codec in
 * client-core) is all Files needs: routes open it, creation menus offer it, downloads export it,
 * and agent changes to it are reviewed with its diff. See docs/live-formats.md.
 */
export interface LiveFormatWeb {
  format: LiveFormatInfo
  /** The creation menu item, e.g. "New text file". */
  newLabel: () => string
  /** The name a new file gets, before the folder makes it unique. */
  newName: () => string
  icon: LucideIcon
  /** Loaded when a document of the format opens, so its editor stays out of the main bundle. */
  Editor: LazyExoticComponent<ComponentType<LiveEditorProps>>
  /** Compares two versions for review; formats without one show a size summary. */
  Diff: LazyExoticComponent<ComponentType<LiveDiffProps>> | ComponentType<LiveDiffProps>
  /** The open document as a file, for downloads that include edits not synced yet. */
  exportFile: (doc: Y.Doc, name: string, assets: LiveAssetStore) => Promise<Uint8Array>
}

export const LIVE_WEB_FORMATS: readonly LiveFormatWeb[] = [
  {
    format: TEXT_FORMAT,
    newLabel: () => ui("New text file"),
    newName: () => `${ui("Untitled")}.txt`,
    icon: FileCode,
    Editor: lazy(() => import('./text/TextDocEditor')),
    Diff: lazy(() => import('./text/TextDiff')),
    exportFile: async (doc, _name, assets) => (await import('@pulpo/client-core/office/text')).exportTextFile(doc, { assets }),
  },
  {
    format: SHEET_FORMAT,
    newLabel: () => ui("New spreadsheet"),
    newName: () => `${ui("Untitled spreadsheet")}.xlsx`,
    icon: FileSpreadsheet,
    Editor: lazy(() => import('./sheets/SheetDocEditor')),
    Diff: lazy(() => import('./sheets/SheetFileDiff')),
    exportFile: async (doc, name, assets) => (await import('./sheets/calculation')).exportSheetFile(doc, name, assets),
  },
]

/** The web side of a document's format, or null for Markdown and formats this build lacks. */
export function liveWebFormat(node: Pick<FileNode, 'kind' | 'format'>): LiveFormatWeb | null {
  if (node.kind !== 'doc') return null
  const format = liveFormat(node.format ?? 'markdown')
  return LIVE_WEB_FORMATS.find((entry) => entry.format.id === format?.id) ?? null
}

/** The diff for a format, with the size summary for formats without one. */
export function liveDiffFor(formatId: string | null | undefined): LiveFormatWeb['Diff'] {
  return LIVE_WEB_FORMATS.find((entry) => entry.format.id === formatId)?.Diff ?? FileVersionsSummary
}
