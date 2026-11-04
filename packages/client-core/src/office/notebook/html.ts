import { Marked, type TokenizerAndRendererExtension } from 'marked'
import { escapeHtml, highlightCss, highlightHtml } from '../../highlight.js'
import { normalizeMathDelimiters } from '../../markdown.js'
import { parseAnsi, type AnsiColor } from './ansi.js'
import {
  imageDataUrl,
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

function mathExtensions(renderMath: NotebookHtmlOptions['renderMath']): TokenizerAndRendererExtension[] {
  const render = (tex: string, display: boolean) => {
    if (renderMath) {
      try {
        return renderMath(tex, display)
      } catch {
        // Fall through to the TeX source.
      }
    }
    return display ? `<div class="math">${escapeHtml(tex)}</div>` : `<code class="math">${escapeHtml(tex)}</code>`
  }
  return [
    {
      name: 'blockMath',
      level: 'block',
      start: (source) => source.indexOf('$$'),
      tokenizer(source) {
        // indexOf rather than a lazy regex, which rescans the rest of the cell at every `$$`.
        if (!source.startsWith('$$')) return undefined
        const close = source.indexOf('$$', 2)
        if (close <= 2) return undefined
        const after = /^[ \t]*(?:\n|$)/.exec(source.slice(close + 2, close + 2 + 64))
        if (!after) return undefined
        const raw = source.slice(0, close + 2 + after[0].length)
        return { type: 'blockMath', raw, text: source.slice(2, close).trim() }
      },
      renderer: (token) => render(String(token.text), true),
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (source) => source.indexOf('$'),
      tokenizer(source) {
        const display = /^\$\$([^$]+?)\$\$/.exec(source)
        if (display) return { type: 'inlineMath', raw: display[0], text: display[1]!.trim(), display: true }
        // `$5 and $6` is money, not math: math may not start or end with a space or end before a digit.
        const match = /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/.exec(source)
        return match ? { type: 'inlineMath', raw: match[0], text: match[1]!, display: false } : undefined
      },
      renderer: (token) => render(String(token.text), Boolean(token.display)),
    },
  ]
}

function markdownRenderer(options: NotebookHtmlOptions) {
  const marked = new Marked({ gfm: true, breaks: false, async: false })
  marked.use({
    extensions: mathExtensions(options.renderMath),
    renderer: {
      code({ text, lang }) {
        return `<pre class="code-highlight"><code>${highlightHtml(text, lang?.split(/\s/)[0] || null)}</code></pre>`
      },
    },
  })
  return (source: string, cellAttachments: Record<string, MimeBundle> = {}) => {
    const html = marked.parse(normalizeMathDelimiters(source)) as string
    // Cell attachments (`![](attachment:plot.png)`) are carried inside the notebook.
    return html.replace(/(src|href)="(attachment:[^"]*)"/g, (match, attribute: string, url: string) => {
      const resolved = resolveAttachmentUrl(url.replace(/&amp;/g, '&'), cellAttachments)
      return resolved ? `${attribute}="${escapeHtml(resolved)}"` : match
    })
  }
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
  const mime = pickOutputMime(output.data)
  const data = mime ? output.data[mime] : undefined
  switch (mime) {
    case 'application/vnd.jupyter.widget-view+json': {
      const plain = output.data['text/plain']
      return typeof plain === 'string' && plain.trim()
        ? `<pre class="output text">${ansiHtml(plain)}</pre>`
        : `<p class="output note">${escapeHtml(labels.widget)}</p>`
    }
    case 'text/html': return `<div class="output html">${String(data)}</div>`
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
.output.html table{border-collapse:collapse;font-size:13px}
.output.html th,.output.html td{border:1px solid #d0d7de;padding:4px 8px;text-align:right}
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(options.title)}</title><style>${css}</style></head><body><main>${cells}</main></body></html>`
}
