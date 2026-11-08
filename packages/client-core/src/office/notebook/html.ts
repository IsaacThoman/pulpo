import { Marked } from 'marked'
import { escapeHtml, highlightCss, highlightHtml } from '../../highlight.js'
import { normalizeMathDelimiters } from '../../markdown.js'
import { parseAnsi, type AnsiColor } from './ansi.js'
import {
  imageDataUrl,
  OUTPUT_MIME_PREFERENCE,
  outputText,
  pickOutputMime,
  resolveAttachmentUrl,
  svgDataUrl,
  type MimeBundle,
  type NotebookCell,
  type NotebookModel,
  type NotebookOutput,
} from './model.js'

/**
 * A notebook as one standalone HTML document, for clients without a React renderer (the mobile
 * apps show it in their sandboxed web preview) and for exports.
 *
 * The document is as untrusted as the notebook: HTML and JavaScript outputs are written into it as
 * they are, so it must only ever be shown where pages run with an opaque origin and no app access
 * (the preview sandbox). Everything else (sources, text output, tracebacks) is escaped.
 */

export interface NotebookHtmlOptions {
  title: string
  /** Renders TeX (without delimiters) as HTML; math stays as escaped TeX without it. */
  renderMath?: (tex: string, display: boolean) => string
  labels?: Partial<NotebookHtmlLabels>
  /**
   * A static page, safe to open anywhere (downloads): no script runs and nothing but images loads
   * from elsewhere. HTML outputs and Markdown keep only inert markup (where `DOMParser` exists;
   * elsewhere HTML outputs show their plain text), JavaScript outputs show their plain text, and a
   * content security policy blocks whatever remains. Math needs no style sheet only as MathML.
   */
  static?: boolean
}

export interface NotebookHtmlLabels {
  /** Shown before a code cell's execution count, as Jupyter's `In [3]:`. */
  input: string
  output: string
  widget: string
  empty: string
  unsupported: string
}

const DEFAULT_LABELS: NotebookHtmlLabels = {
  input: 'In',
  output: 'Out',
  widget: 'Interactive widgets need a running kernel and are not shown.',
  empty: 'This notebook has no cells.',
  unsupported: 'This output type can’t be shown',
}

const ANSI_HEX: Record<string, [string, string]> = {
  black: ['#3e424d', '#a0a6b0'],
  red: ['#c4302b', '#ff7b72'],
  green: ['#2e7d32', '#7ee787'],
  yellow: ['#9a6700', '#f2cc60'],
  blue: ['#0550ae', '#79c0ff'],
  magenta: ['#8250df', '#d2a8ff'],
  cyan: ['#1b7c83', '#76e3ea'],
  white: ['#c5c8ce', '#e6edf3'],
}

/** Elements a static page drops with their content: they run, load, embed, or submit. */
const ACTIVE_ELEMENTS = 'script,style,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,textarea,select,option,noscript,template,portal,video,audio,source,track,canvas,dialog,svg,math'
/** Where a static page's links and images may point. */
const SAFE_URL = /^(https?:|mailto:|#)/i
const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*$/i

/** The policy a static page carries: inline styles and images only. */
const STATIC_POLICY = "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'"

/**
 * Markup made inert for a static page: active elements removed, event handlers and script URLs
 * stripped. Null where there is no `DOMParser` to do it with.
 */
export function inertHtml(html: string): string | null {
  if (typeof DOMParser === 'undefined') return null
  // An inert document: nothing in it loads or runs while it is cleaned.
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  for (const node of parsed.body.querySelectorAll(ACTIVE_ELEMENTS)) node.remove()
  for (const node of parsed.body.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'srcset' || name === 'ping') node.removeAttribute(attribute.name)
      else if ((name === 'href' || name === 'xlink:href' || name === 'action' || name === 'background' || name === 'poster') && !SAFE_URL.test(value)) node.removeAttribute(attribute.name)
      else if (name === 'src' && !SAFE_URL.test(value) && !SAFE_IMAGE.test(value)) node.removeAttribute(attribute.name)
    }
  }
  return parsed.body.innerHTML
}

function ansiClass(color: AnsiColor | undefined, prefix: 'fg' | 'bg'): string | null {
  if (!color || color.startsWith('#')) return null
  return `ansi-${prefix}-${color}`
}

/** Terminal text with its ANSI colors as classes (named colors) or inline styles (exact colors). */
export function ansiHtml(text: string): string {
  return parseAnsi(text).map(({ text: value, style }) => {
    const classes = [ansiClass(style.fg, 'fg'), ansiClass(style.bg, 'bg'), style.bold && 'ansi-bold', style.dim && 'ansi-dim', style.italic && 'ansi-italic', style.underline && 'ansi-underline'].filter(Boolean)
    const css = [style.fg?.startsWith('#') && `color:${style.fg}`, style.bg?.startsWith('#') && `background:${style.bg}`].filter(Boolean)
    if (!classes.length && !css.length) return escapeHtml(value)
    return `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}${css.length ? ` style="${css.join(';')}"` : ''}>${escapeHtml(value)}</span>`
  }).join('')
}

function ansiCss(): string {
  const rules: string[] = []
  for (const [name, [light, dark]] of Object.entries(ANSI_HEX)) {
    rules.push(`.ansi-fg-${name},.ansi-fg-bright-${name}{color:${light}}`, `.ansi-bg-${name},.ansi-bg-bright-${name}{background:${light}33}`)
    rules.push(`@media (prefers-color-scheme: dark){.ansi-fg-${name},.ansi-fg-bright-${name}{color:${dark}}.ansi-bg-${name},.ansi-bg-bright-${name}{background:${dark}33}}`)
  }
  rules.push('.ansi-bold{font-weight:700}.ansi-dim{opacity:.7}.ansi-italic{font-style:italic}.ansi-underline{text-decoration:underline}')
  return rules.join('\n')
}

/** Markdown longer than this shows as plain text. */
const MAX_MARKDOWN_CHARACTERS = 100_000
/** Block math may span at most this many lines; longer runs are left as text. */
const MAX_MATH_LINES = 200

/**
 * Takes TeX out of Markdown before it is parsed, in one pass, so marked never sees it (marked's own
 * extension hooks rescan the rest of a cell at every `$$`, which is quadratic on hostile input).
 * Fenced code and inline code are left alone. Each formula becomes a placeholder word that
 * `restoreMath` swaps for its rendering after parsing.
 */
export function extractMath(markdown: string): { text: string; formulas: { tex: string; display: boolean }[]; token: string } {
  const formulas: { tex: string; display: boolean }[] = []
  // A token that cannot occur in the cell, so placeholders never collide with its text.
  let token = 'PULPOMATH'
  while (markdown.includes(token)) token += 'X'
  const placeholder = (tex: string, display: boolean) => {
    formulas.push({ tex, display })
    return `${token}${formulas.length - 1}${token}`
  }
  const lines = markdown.split('\n')
  const out: string[] = []
  let fence: string | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      out.push(line)
      if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!
      out.push(line)
      continue
    }
    const trimmed = line.trim()
    // Block math: a line opening with `$$`, closed by a line ending with `$$` (possibly the same).
    if (trimmed.startsWith('$$')) {
      const sameLine = trimmed.length > 4 && trimmed.endsWith('$$') && !trimmed.slice(2, -2).includes('$$')
      if (sameLine) {
        out.push(placeholder(trimmed.slice(2, -2).trim(), true))
        continue
      }
      if (trimmed === '$$' || !trimmed.slice(2).includes('$')) {
        let close = -1
        for (let next = index + 1; next < lines.length && next <= index + MAX_MATH_LINES; next += 1) {
          if (lines[next]!.trim().endsWith('$$')) {
            close = next
            break
          }
        }
        if (close > index) {
          const body = [trimmed.slice(2), ...lines.slice(index + 1, close), lines[close]!.trim().slice(0, -2)].join('\n').trim()
          out.push(placeholder(body, true))
          index = close
          continue
        }
      }
    }
    out.push(inlineMath(line, placeholder))
  }
  return { text: out.join('\n'), formulas, token }
}

/** Inline `$…$` and `$$…$$` in one line, outside code spans. `$5 and $6` stays money. */
function inlineMath(line: string, placeholder: (tex: string, display: boolean) => string): string {
  if (!line.includes('$')) return line
  let result = ''
  let index = 0
  while (index < line.length) {
    const character = line[index]!
    if (character === '`') {
      // Skip a code span: the run of backticks up to the same run closing it.
      let length = 1
      while (line[index + length] === '`') length += 1
      const run = '`'.repeat(length)
      const close = line.indexOf(run, index + length)
      // An unclosed run is literal backticks; skipping just the run keeps the scan linear.
      const end = close < 0 ? index + length : close + length
      result += line.slice(index, end)
      index = end
      continue
    }
    if (character === '\\' && index + 1 < line.length) {
      result += line.slice(index, index + 2)
      index += 2
      continue
    }
    if (character === '$') {
      const display = line[index + 1] === '$'
      const open = display ? 2 : 1
      const delimiter = display ? '$$' : '$'
      const close = line.indexOf(delimiter, index + open)
      const tex = close < 0 ? '' : line.slice(index + open, close)
      const after = line.charCodeAt(close + 1)
      const valid = close > index + open && (display || (!/^\s/.test(tex) && !/\s$/.test(tex) && !(after >= 48 && after <= 57)))
      if (valid) {
        result += placeholder(display ? tex.trim() : tex, display)
        index = close + open
        continue
      }
    }
    result += character
    index += 1
  }
  return result
}

/** Puts rendered formulas back in place of `extractMath`'s placeholders. */
export function restoreMath(html: string, formulas: readonly { tex: string; display: boolean }[], token: string, render: (tex: string, display: boolean) => string): string {
  if (!formulas.length) return html
  const pattern = new RegExp(`(<p>)?${token}(\\d+)${token}(</p>)?`, 'g')
  return html.replace(pattern, (match, open: string | undefined, number: string, close: string | undefined) => {
    const formula = formulas[Number(number)]
    if (!formula) return match
    const rendered = render(formula.tex, formula.display)
    // A display formula alone in a paragraph replaces the paragraph.
    if (formula.display && open && close) return rendered
    return `${open ?? ''}${rendered}${close ?? ''}`
  })
}

function markdownRenderer(options: NotebookHtmlOptions) {
  const marked = new Marked({ gfm: true, breaks: false, async: false })
  marked.use({
    renderer: {
      code({ text, lang }) {
        return `<pre class="code-highlight"><code>${highlightHtml(text, lang?.split(/\s/)[0] || null)}</code></pre>`
      },
    },
  })
  const render = (tex: string, display: boolean) => {
    if (options.renderMath) {
      try {
        return options.renderMath(tex, display)
      } catch {
        // Fall through to the TeX source.
      }
    }
    return display ? `<div class="math">${escapeHtml(tex)}</div>` : `<code class="math">${escapeHtml(tex)}</code>`
  }
  return (source: string, cellAttachments: Record<string, MimeBundle> = {}) => {
    // marked slows down sharply on some huge, hostile cells; real prose is far shorter.
    if (source.length > MAX_MARKDOWN_CHARACTERS) return `<pre>${escapeHtml(source)}</pre>`
    const { text, formulas, token } = extractMath(normalizeMathDelimiters(source))
    // Cell attachments (`![](attachment:plot.png)`) are carried inside the notebook.
    const html = (marked.parse(text) as string).replace(/(src|href)="(attachment:[^"]*)"/g, (match, attribute: string, url: string) => {
      const resolved = resolveAttachmentUrl(url.replace(/&amp;/g, '&'), cellAttachments)
      return resolved ? `${attribute}="${escapeHtml(resolved)}"` : match
    })
    // A static page keeps only inert markup; the math rendered after it is the renderer's own.
    return restoreMath(options.static ? inertHtml(html) ?? html : html, formulas, token, render)
  }
}

/** Output types a static page shows: no scripts, and HTML only where it can be made inert. */
function staticMimes(): string[] {
  return OUTPUT_MIME_PREFERENCE.filter((mime) => mime !== 'application/javascript' && (mime !== 'text/html' || typeof DOMParser !== 'undefined'))
}

function prompt(label: string, count: number | null): string {
  return `<div class="prompt">${escapeHtml(label)}&nbsp;[${count ?? '&nbsp;'}]:</div>`
}

function outputHtml(output: NotebookOutput, labels: NotebookHtmlLabels, options: NotebookHtmlOptions, markdown: ReturnType<typeof markdownRenderer>): string {
  if (output.type === 'stream') return `<pre class="output stream ${output.name}">${ansiHtml(output.text)}</pre>`
  if (output.type === 'error') {
    const text = output.traceback.length ? output.traceback.join('\n') : `${output.ename}: ${output.evalue}`
    return `<pre class="output error">${ansiHtml(text)}</pre>`
  }
  const mime = pickOutputMime(output.data, options.static ? staticMimes() : OUTPUT_MIME_PREFERENCE)
  const data = mime ? output.data[mime] : undefined
  switch (mime) {
    case 'application/vnd.jupyter.widget-view+json': {
      const plain = output.data['text/plain']
      return typeof plain === 'string' && plain.trim()
        ? `<pre class="output text">${ansiHtml(plain)}</pre>`
        : `<p class="output note">${escapeHtml(labels.widget)}</p>`
    }
    case 'text/html': return `<div class="output html">${options.static ? inertHtml(String(data)) ?? '' : String(data)}</div>`
    case 'application/javascript': return `<div class="output html"><script>${String(data).replace(/<\/script/gi, '<\\/script')}</script></div>`
    case 'image/svg+xml': {
      const url = svgDataUrl(data)
      return url ? `<div class="output image"><img alt="" src="${escapeHtml(url)}"></div>` : ''
    }
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp': {
      const url = imageDataUrl(mime, data)
      return url ? `<div class="output image"><img alt="" src="${escapeHtml(url)}"></div>` : ''
    }
    case 'text/markdown': return `<div class="output markdown">${markdown(String(data))}</div>`
    case 'text/latex': {
      const tex = String(data).trim().replace(/^\$\$?|\$\$?$/g, '')
      if (options.renderMath) {
        try {
          return `<div class="output math">${options.renderMath(tex, true)}</div>`
        } catch {
          // Show the source instead.
        }
      }
      return `<pre class="output text">${escapeHtml(String(data))}</pre>`
    }
    case 'application/json': return `<pre class="output json code-highlight">${highlightHtml(outputText(mime, data), 'json')}</pre>`
    case 'text/plain': return `<pre class="output text">${ansiHtml(String(data))}</pre>`
    case null:
    case undefined: {
      const types = Object.keys(output.data)
      return types.length ? `<p class="output note">${escapeHtml(labels.unsupported)}: ${escapeHtml(types.join(', '))}</p>` : ''
    }
    default: return `<pre class="output text">${escapeHtml(outputText(mime, data))}</pre>`
  }
}

function cellHtml(cell: NotebookCell, model: NotebookModel, labels: NotebookHtmlLabels, options: NotebookHtmlOptions, markdown: ReturnType<typeof markdownRenderer>): string {
  if (cell.type === 'markdown') return `<section class="cell markdown">${markdown(cell.source, cell.attachments)}</section>`
  if (cell.type === 'raw') return `<section class="cell raw"><pre>${escapeHtml(cell.source)}</pre></section>`
  const source = `<div class="input">${prompt(labels.input, cell.executionCount)}<pre class="source code-highlight"><code>${highlightHtml(cell.source, model.language ?? 'python')}</code></pre></div>`
  const outputs = cell.outputs.map((output) => {
    const body = outputHtml(output, labels, options, markdown)
    if (!body) return ''
    const label = output.type === 'execute_result' ? prompt(labels.output, output.executionCount) : '<div class="prompt"></div>'
    return `<div class="output-row">${label}${body}</div>`
  }).join('')
  return `<section class="cell code">${source}${outputs ? `<div class="outputs">${outputs}</div>` : ''}</section>`
}

const BASE_CSS = `
:root{color-scheme:light dark;--fg:#1f2328;--muted:#656d76;--border:#d0d7de;--code:#f6f8fa;--bg:#fff;--error:#ffebe9}
@media (prefers-color-scheme: dark){:root{--fg:#e6edf3;--muted:#8d96a0;--border:#30363d;--code:#161b22;--bg:#0d1117;--error:#3c1618}}
html,body{margin:0;background:var(--bg);color:var(--fg)}
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:960px;margin:0 auto;padding:12px 14px 48px}
.cell{margin:0 0 14px}
.cell.markdown{padding:0 2px}
.cell.markdown img,.output img{max-width:100%;height:auto}
.input{display:flex;flex-direction:column;gap:2px}
.prompt{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);min-height:2px}
pre{margin:0;overflow-x:auto;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}
pre.source{background:var(--code);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.outputs{margin-top:6px;display:flex;flex-direction:column;gap:6px}
.output-row{display:flex;flex-direction:column;gap:2px;min-width:0}
.output{min-width:0;overflow-x:auto}
pre.output{padding:2px 2px}
pre.output.stderr{background:var(--error);border-radius:6px;padding:6px 8px}
pre.output.error{background:var(--error);border-radius:6px;padding:8px 10px}
.output.html{background:#fff;color:#1f2328;border-radius:6px}
.output.html{padding:6px 8px}
.output.html table.dataframe{border:none;border-collapse:collapse;font-size:12.5px}
.output.html table.dataframe thead{border-bottom:1px solid #d0d7de}
.output.html table.dataframe th,.output.html table.dataframe td{border:none;padding:4px 10px;text-align:right;white-space:nowrap}
.output.html table.dataframe tbody tr:nth-child(odd){background:#f6f8fa}
.output.note{color:var(--muted);font-size:13px;margin:0}
.markdown table{border-collapse:collapse}
.markdown th,.markdown td{border:1px solid var(--border);padding:4px 8px}
.markdown pre{background:var(--code);border-radius:8px;padding:10px 12px}
.markdown code{font:0.9em ui-monospace,SFMono-Regular,Menlo,monospace}
.markdown blockquote{margin:0;padding-left:12px;border-left:3px solid var(--border);color:var(--muted)}
.math{overflow-x:auto}
.empty{color:var(--muted);text-align:center;padding:48px 0}
`

/** The notebook as a standalone HTML document; see the module comment before showing it. */
export function renderNotebookHtml(model: NotebookModel, options: NotebookHtmlOptions): string {
  const labels = { ...DEFAULT_LABELS, ...options.labels }
  const markdown = markdownRenderer(options)
  const cells = model.cells.length
    ? model.cells.map((cell) => cellHtml(cell, model, labels, options, markdown)).join('\n')
    : `<p class="empty">${escapeHtml(labels.empty)}</p>`
  const css = [
    BASE_CSS,
    highlightCss('.code-highlight', 'light'),
    `@media (prefers-color-scheme: dark){${highlightCss('.code-highlight', 'dark')}}`,
    ansiCss(),
  ].join('\n')
  const policy = options.static ? `<meta http-equiv="Content-Security-Policy" content="${STATIC_POLICY}">` : ''
  return `<!doctype html><html><head><meta charset="utf-8">${policy}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(options.title)}</title><style>${css}</style></head><body><main>${cells}</main></body></html>`
}
