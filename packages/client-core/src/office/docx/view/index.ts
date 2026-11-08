export { DocxEditor, type DocxContextInfo, type DocxEditorOptions, type DocxFormattingState, type DocxLayout, type DocxMode, type DocxRefusedImage, type DocxRequest } from './editor.js'
export { DEFAULT_DOCX_LABELS, type DocxLabels } from './labels.js'
export type {
  Alignment,
  BorderPreset,
  CaseChange,
  CellVerticalAlign,
  HeaderFooterKind,
  HeaderFooterType,
  LineSpacing,
  LinkRange,
  ListKind,
  OutlineEntry,
  PageMargins,
  PageSetupChange,
  PageSetupInfo,
  ParagraphBorder,
  ParagraphFormat,
  ParagraphFormatChange,
  WordCount,
} from './commands.js'
export type { AutoformatOptions } from './autoformat.js'
export type { HeaderFooterInfo } from './headers.js'
export type { CommentThread } from './stories.js'
export type { Revision, RevisionKind } from './track-changes.js'
export type { LayoutResult } from './layout.js'
export { DOCX_BASE_CSS } from './stylesheet.js'
