import type * as Y from 'yjs'
import type { LiveFormatContext } from '../live-format.js'
import { exportNotebookFile } from './codec.js'
import { decodeNotebookBytes } from './file.js'
import { renderNotebookHtml, type NotebookHtmlOptions } from './html.js'
import { cellSourceText, cellType, metadataValue, notebookLanguage, notebookMetadata, orderedCells } from './layout.js'
import { parseNotebook } from './model.js'

/**
 * A notebook downloaded as something else: a script (as Colab's Download .py and JupyterLab's
 * Export as Python do it) or a static web page (as nbconvert's HTML). The `.ipynb` itself stays
 * the codec's export.
 */

export interface NotebookScript {
  text: string
  /** With its dot (`.py`). */
  extension: string
  mimeType: string
}

/** Script extensions by kernel language, for notebooks whose `language_info` names none. */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: '.py', python3: '.py', ipython: '.py', r: '.r', julia: '.jl', javascript: '.js', typescript: '.ts', scala: '.scala',
  java: '.java', kotlin: '.kt', 'c++': '.cpp', cpp: '.cpp', c: '.c', 'c#': '.cs', csharp: '.cs', 'f#': '.fs', fsharp: '.fs',
  ruby: '.rb', rust: '.rs', go: '.go', sql: '.sql', bash: '.sh', sh: '.sh', shell: '.sh', haskell: '.hs', lua: '.lua', perl: '.pl',
  php: '.php', swift: '.swift', groovy: '.groovy', clojure: '.clj', erlang: '.erl', powershell: '.ps1', dart: '.dart', elixir: '.ex',
  matlab: '.m', octave: '.m',
}

/** Line comments by script extension; Jupytext writes its cell markers in them. */
const COMMENTS: Record<string, string> = {
  '.js': '//', '.ts': '//', '.scala': '//', '.java': '//', '.kt': '//', '.cpp': '//', '.c': '//', '.cs': '//', '.fs': '//', '.go': '//',
  '.rs': '//', '.swift': '//', '.groovy': '//', '.dart': '//', '.php': '//', '.sql': '--', '.lua': '--', '.hs': '--', '.clj': ';;',
  '.erl': '%', '.m': '%',
}

const MIME_TYPES: Record<string, string> = { '.py': 'text/x-python', '.r': 'text/x-r', '.jl': 'text/x-julia', '.js': 'text/javascript', '.ts': 'text/typescript', '.sh': 'text/x-shellscript' }

function scriptExtension(doc: Y.Doc): string {
  const info = metadataValue(notebookMetadata(doc), 'language_info') as { file_extension?: unknown } | undefined
  const declared = typeof info?.file_extension === 'string' ? info.file_extension.toLowerCase() : ''
  if (/^\.[a-z0-9+_-]{1,10}$/.test(declared)) return declared
  return LANGUAGE_EXTENSIONS[notebookLanguage(doc)] ?? '.txt'
}

/** IPython's magics and shell escapes, which a Python file would not run; Jupytext comments them out too. */
const MAGIC = /^\s*(%{1,2}[A-Za-z]|!)/

/**
 * The notebook as a script in Jupytext's percent format, which VS Code, Spyder, and PyCharm read
 * as cells: each cell under a `# %%` line, Markdown and raw cells as comments (`# %% [markdown]`).
 * In Python, magics and shell escapes are commented out so the script runs; a cell that starts
 * with a cell magic (`%%bash`) is commented out whole.
 */
export function notebookToScript(doc: Y.Doc): NotebookScript {
  const extension = scriptExtension(doc)
  const comment = COMMENTS[extension] ?? '#'
  const python = extension === '.py'
  const commented = (text: string) => text.split('\n').map((line) => (line ? `${comment} ${line}` : comment)).join('\n')
  const cells = orderedCells(doc).map(({ cell }) => {
    const type = cellType(cell)
    const source = cellSourceText(cell).replace(/\r\n?/g, '\n').replace(/\n+$/, '')
    if (type !== 'code') return `${comment} %% [${type}]${source ? `\n${commented(source)}` : ''}`
    if (!python || !source) return `${comment} %%${source ? `\n${source}` : ''}`
    if (/^\s*%%[A-Za-z]/.test(source)) return `${comment} %%\n${commented(source)}`
    return `${comment} %%\n${source.split('\n').map((line) => (MAGIC.test(line) ? `${comment} ${line}` : line)).join('\n')}`
  })
  return { text: cells.length ? `${cells.join('\n\n')}\n` : '', extension, mimeType: MIME_TYPES[extension] ?? 'text/plain' }
}

/**
 * The notebook as a static web page (see `NotebookHtmlOptions.static`): what downloading it
 * gives now, edits included, rendered as the mobile viewer renders it but with nothing active.
 */
export async function notebookToHtml(doc: Y.Doc, context: Pick<LiveFormatContext, 'assets'>, options: Omit<NotebookHtmlOptions, 'static'>): Promise<string> {
  const bytes = await exportNotebookFile(doc, context)
  return renderNotebookHtml(parseNotebook(decodeNotebookBytes(bytes).text), { ...options, static: true })
}
