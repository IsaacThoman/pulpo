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

/**
 * IPython's magics and shell escapes (`%time`, `!pip`, `! ls`, `!!ls`, and assigned, `files = !ls`),
 * which a Python file would not run; Jupytext comments them out too. `!=` is Python's own.
 */
const MAGIC = /^\s*(?:[\p{L}_][\p{L}\p{N}_]*\s*=\s*)?(?:%{1,2}[A-Za-z]|!(?!=))/u

/** Where Python's tokenizer is after a line: in a string (its quotes), how deep in brackets, after a backslash. */
interface PythonScan {
  quote: string | null
  depth: number
  continued: boolean
}

/** Moves `scan` past one line of Python: its strings, comment, brackets, and a backslash at its end. */
function scanPythonLine(line: string, scan: PythonScan): void {
  scan.continued = false
  let index = 0
  while (index < line.length) {
    const char = line[index]!
    if (scan.quote) {
      if (char === '\\') index += 2
      else if (line.startsWith(scan.quote, index)) {
        index += scan.quote.length
        scan.quote = null
      } else index += 1
      continue
    }
    if (char === '#') break
    if (char === '"' || char === "'") {
      scan.quote = line.startsWith(char.repeat(3), index) ? char.repeat(3) : char
      index += scan.quote.length
      continue
    }
    if (char === '(' || char === '[' || char === '{') scan.depth += 1
    else if (char === ')' || char === ']' || char === '}') scan.depth = Math.max(0, scan.depth - 1)
    else if (char === '\\' && index === line.length - 1) scan.continued = true
    index += 1
  }
  // A one-quote string ends with its line, unless a backslash carries it on (which steps past the end).
  if (scan.quote?.length === 1 && index <= line.length) scan.quote = null
}

/**
 * Comments out a Python cell's magics, as Jupytext does (after their indentation). IPython reads
 * them only where a statement starts, so lines inside a string (`"""` … `%s rows`) or brackets, or
 * after a backslash, stay Python: a `!=` that continues a condition, say. A backslash at its end
 * carries a magic on to the next line, which is commented out as it is.
 */
function commentMagics(source: string, comment: string): string {
  const scan: PythonScan = { quote: null, depth: 0, continued: false }
  let inMagic = false
  return source.split('\n').map((line) => {
    const statement = !scan.quote && !scan.depth && !scan.continued
    if (inMagic) {
      inMagic = /\\\s*$/.test(line)
      return `${comment} ${line}`
    }
    if (statement && MAGIC.test(line)) {
      inMagic = /\\\s*$/.test(line)
      const indent = /^\s*/.exec(line)![0]
      return `${indent}${comment} ${line.slice(indent.length)}`
    }
    scanPythonLine(line, scan)
    return line
  }).join('\n')
}

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
    return `${comment} %%\n${commentMagics(source, comment)}`
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
