import { NotebookError, parseNotebook, renderNotebookHtml } from '@pulpo/client-core/office/notebook'
import { AttachmentPreviewError, previewWebDocument, supportsWebDocumentPreview } from '../../../native/attachmentPreview'
import { textExportFile } from '../api'

/** Why a notebook opened as text instead, shown above its source. */
export type NotebookFallback = { notice: string }

function fallbackNotice(error: unknown): string {
  if (error instanceof NotebookError) {
    switch (error.code) {
      case 'invalid_json': return 'This notebook isn’t valid JSON, so it can’t be shown as a notebook. Its text is below.'
      case 'too_large': return 'This notebook has too many cells to show. Its text is below.'
      case 'unsupported_version': return 'This notebook uses a format version that can’t be shown. Its text is below.'
      default: return 'This file isn’t a Jupyter notebook. Its text is below.'
    }
  }
  if (error instanceof AttachmentPreviewError && error.code === 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED') {
    return 'This notebook is too large to show here. Its text is below.'
  }
  return 'This notebook can’t be shown in this version of the app. Its text is below.'
}

/** TeX as MathML, which WebKit and Chrome draw without KaTeX's fonts or styles. */
async function mathRenderer(): Promise<(tex: string, display: boolean) => string> {
  const katex = (await import('katex')).default
  return (tex, display) => katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: false, trust: false, maxExpand: 500 })
}

/**
 * Shows a notebook as one page in the sandboxed web preview (opaque origin, no app access), where
 * its HTML and JavaScript outputs can run as they would in Jupyter. Returns a fallback when it has to
 * be read as text instead: it isn't a notebook, it is too large, or the app predates the preview.
 */
export async function openNotebook(text: string, name: string): Promise<NotebookFallback | null> {
  if (!supportsWebDocumentPreview) return { notice: fallbackNotice(null) }
  try {
    const notebook = parseNotebook(text)
    const html = renderNotebookHtml(notebook, { title: name, renderMath: await mathRenderer() })
    // Kept with exports, which signing out removes.
    const file = textExportFile(`${name.replace(/\.ipynb$/i, '')}.html`, html)
    await previewWebDocument(file.uri, name)
    return null
  } catch (error) {
    if (error instanceof NotebookError || (error instanceof AttachmentPreviewError && error.code === 'ERR_ATTACHMENT_PREVIEW_UNSUPPORTED')) {
      return { notice: fallbackNotice(error) }
    }
    throw error
  }
}
