import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { DOCUMENT_FORMAT, liveFormat, SHEET_FORMAT, NOTEBOOK_FORMAT, PRESENTATION_FORMAT, TEXT_FORMAT, type LiveAssetStore, type LiveFormatInfo } from '@pulpo/client-core/office'
import type { FileNode } from '@pulpo/contracts'
import { FileCode, FileSpreadsheet, FileText, NotebookPen, Presentation, type LucideIcon } from 'lucide-react'
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
  /** What the format is called in File ▸ New and Details, e.g. "Spreadsheet". */
  typeLabel: () => string
  /** The name a new file gets, before the folder makes it unique. */
  newName: () => string
  icon: LucideIcon
  /** Loaded when a document of the format opens, so its editor stays out of the main bundle. */
  Editor: LazyExoticComponent<ComponentType<LiveEditorProps>>
  /** Compares two versions for review; formats without one show a size summary. */
  Diff: LazyExoticComponent<ComponentType<LiveDiffProps>> | ComponentType<LiveDiffProps>
  /** The open document as a file, for downloads that include edits not synced yet. */
  exportFile: (doc: Y.Doc, name: string, assets: LiveAssetStore) => Promise<Uint8Array>
  /** Files of the format run (notebooks): the editor offers to have an agent run them. */
  runsWithAgent?: boolean
}

export const LIVE_WEB_FORMATS: readonly LiveFormatWeb[] = [
  {
    format: TEXT_FORMAT,
    newLabel: () => ui("New text file"),
    typeLabel: () => ui("Text file"),
    newName: () => `${ui("Untitled")}.txt`,
    icon: FileCode,
    Editor: lazy(() => import('./text/TextDocEditor')),
    Diff: lazy(() => import('./text/TextDiff')),
    exportFile: async (doc, _name, assets) => (await import('@pulpo/client-core/office/text')).exportTextFile(doc, { assets }),
  },
  {
    format: NOTEBOOK_FORMAT,
    newLabel: () => ui("New notebook"),
    typeLabel: () => ui("Notebook"),
    newName: () => `${ui("Untitled")}.ipynb`,
    icon: NotebookPen,
    Editor: lazy(() => import('./notebook/NotebookDocEditor')),
    Diff: lazy(() => import('./notebook/NotebookDiff')),
    exportFile: async (doc, _name, assets) => (await import('@pulpo/client-core/office/notebook')).exportNotebookFile(doc, { assets }),
    runsWithAgent: true,
  },
  {
    format: PRESENTATION_FORMAT,
    newLabel: () => ui("New presentation"),
    typeLabel: () => ui("Presentation"),
    newName: () => `${ui("Untitled presentation")}.pptx`,
    icon: Presentation,
    Editor: lazy(() => import('./presentation/PresentationDocEditor')),
    Diff: lazy(() => import('./presentation/PresentationFileDiff')),
    exportFile: async (doc, name, assets) => (await import('@pulpo/client-core/office/presentation')).presentationCodec.exportFile(doc, { name, assets }),
  },
  {
    format: DOCUMENT_FORMAT,
    newLabel: () => ui("New Word document"),
    typeLabel: () => ui("Word document"),
    newName: () => `${ui("Untitled document")}.docx`,
    icon: FileText,
    Editor: lazy(() => import('./docx/LiveDocxEditor')),
    Diff: lazy(() => import('./docx/LiveDocxDiff')),
    exportFile: async (doc, name, assets) => (await import('@pulpo/client-core/office/docx')).docxCodec.exportFile(doc, { name, assets }),
  },
  {
    format: SHEET_FORMAT,
    newLabel: () => ui("New spreadsheet"),
    typeLabel: () => ui("Spreadsheet"),
    newName: () => `${ui("Untitled spreadsheet")}.xlsx`,
    icon: FileSpreadsheet,
    Editor: lazy(() => import('./sheets/SheetDocEditor')),
    Diff: lazy(() => import('./sheets/SheetFileDiff')),
    exportFile: async (doc, name, assets) => (await import('./sheets/calculation')).exportSheetFile(doc, name, assets),
  },
]

/** File ▸ New's order: the Office formats first, as Drive and OneDrive list them. */
const NEW_ORDER = ['document', 'sheet', 'presentation', 'notebook', 'text']

/** Live formats in creation menus' order (Word, spreadsheet, presentation, notebook, text). */
export function liveFormatsForNew(): readonly LiveFormatWeb[] {
  return [...LIVE_WEB_FORMATS].sort((a, b) => NEW_ORDER.indexOf(a.format.id) - NEW_ORDER.indexOf(b.format.id))
}

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
