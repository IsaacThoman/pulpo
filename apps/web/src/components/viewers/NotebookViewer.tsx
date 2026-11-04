import { memo, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { defaultUrlTransform, type Components, type UrlTransform } from 'react-markdown'
import { BookOpen, FileJson, TriangleAlert } from 'lucide-react'
import {
  imageDataUrl,
  NotebookError,
  outputText,
  parseAnsi,
  parseNotebook,
  pickOutputMime,
  resolveAttachmentUrl,
  svgDataUrl,
  type MimeBundle,
  type NotebookCell,
  type NotebookModel,
  type NotebookOutput,
} from '@pulpo/client-core/office/notebook'
import { HighlightedCode } from '@/components/chat/HighlightedCode'
import { Markdown, MarkdownImage } from '@/components/chat/Markdown'
import { SandboxFrame } from '@/components/chat/SandboxFrame'
import { Button } from '@/components/ui/button'
import { activeLocale, ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { CodeViewer } from './CodeViewer'
import { useDarkTheme } from './use-dark-theme'
import { ViewerStatus, ViewerToolbar, ViewerToolbarSpacer, ViewModeToggle } from './ViewerChrome'

/** Outputs longer than this show their start, with a button for the rest. */
const MAX_OUTPUT_CHARACTERS = 50_000
/** Viewers render these output types; the notebook picks the richest one each output has. */
const SUPPORTED_OUTPUTS = [
  'application/vnd.jupyter.widget-view+json',
  'application/javascript',
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/markdown',
  'text/latex',
  'application/json',
  'text/plain',
] as const

/**
 * What JupyterLab gives HTML output: the page font and its pandas table style. Outputs bring their
 * own styles, which come later and win.
 */
function outputFrameCss(dark: boolean): string {
  const [background, text, stripe, hover, rule] = dark
    ? ['#0d1117', '#e6edf3', '#161b22', '#1f2a37', '#30363d']
    : ['#fff', '#1f2328', '#f6f8fa', '#ddf4ff', '#d0d7de']
  return [
    `html,body{margin:0;background:${background};color:${text};color-scheme:${dark ? 'dark' : 'light'}}`,
    'body{padding:8px 10px;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-x:auto}',
    'table.dataframe,.rendered_html table{border:none;border-collapse:collapse;border-spacing:0;font-size:12px;table-layout:fixed}',
    `table.dataframe thead{border-bottom:1px solid ${rule};vertical-align:bottom}`,
    'table.dataframe th,table.dataframe td{border:none;padding:4px 10px;text-align:right;vertical-align:middle;white-space:nowrap;max-width:none}',
    'table.dataframe th{font-weight:600}',
    `table.dataframe tbody tr:nth-child(odd){background:${stripe}}`,
    `table.dataframe tbody tr:hover{background:${hover}}`,
  ].join('')
}

/** Terminal output with its ANSI colors, as text nodes only. */
const AnsiText = memo(function AnsiText({ text }: { text: string }) {
  const segments = useMemo(() => parseAnsi(text), [text])
  return (
    <>
      {segments.map(({ text: value, style }, index) => {
        if (!style.fg && !style.bg && !style.bold && !style.italic && !style.underline && !style.dim) return value
        const named = (color: string | undefined, prefix: 'fg' | 'bg') => (color && !color.startsWith('#') ? `ansi-${prefix}-${color}` : null)
        return (
          <span
            key={index}
            className={cn(named(style.fg, 'fg'), named(style.bg, 'bg'), style.bold && 'font-bold', style.dim && 'opacity-70', style.italic && 'italic', style.underline && 'underline')}
            style={{ color: style.fg?.startsWith('#') ? style.fg : undefined, backgroundColor: style.bg?.startsWith('#') ? style.bg : undefined }}
          >
            {value}
          </span>
        )
      })}
    </>
  )
})

function LongText({ text, children }: { text: string; children: (text: string) => ReactNode }) {
  const [all, setAll] = useState(false)
  if (all || text.length <= MAX_OUTPUT_CHARACTERS) return <>{children(text)}</>
  return (
    <>
      {children(text.slice(0, MAX_OUTPUT_CHARACTERS))}
      <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setAll(true)}>
        {uit`Show all ${text.length.toLocaleString(activeLocale())} characters`}
      </Button>
    </>
  )
}

/** Mounts its children once they come near the viewport, so a notebook's many frames load as they scroll in. */
function WhenVisible({ children, placeholderHeight }: { children: ReactNode; placeholderHeight: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver !== 'function')
  useEffect(() => {
    if (visible || !ref.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
    }, { rootMargin: '800px 0px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [visible])
  return <div ref={ref} style={visible ? undefined : { height: placeholderHeight }}>{visible ? children : null}</div>
}

function notebookUrlTransform(attachments: Record<string, MimeBundle>): UrlTransform {
  return (url, key) => {
    if (key === 'src' && url.startsWith('attachment:')) return resolveAttachmentUrl(url, attachments) ?? ''
    // Notebooks embed their images as data URLs; only base64 raster images are let through.
    if (key === 'src' && url.startsWith('data:')) {
      const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.*)$/s.exec(url)
      return match ? imageDataUrl(match[1]!, match[2]) ?? '' : ''
    }
    return defaultUrlTransform(url)
  }
}

/**
 * Embedded images show inline; remote ones stay links, as in chat, so Markdown cells fetch nothing.
 * (HTML and JavaScript outputs run in the sandbox, whose policy lets them load what they link.)
 */
function NotebookImage(props: ComponentProps<'img'>) {
  const src = typeof props.src === 'string' ? props.src : ''
  if (src.startsWith('data:image/')) return <img src={src} alt={props.alt ?? ''} className="my-2 max-w-full rounded" />
  return <MarkdownImage {...props} />
}

const NOTEBOOK_MARKDOWN_COMPONENTS: Components = { img: NotebookImage }
const NO_ATTACHMENTS: Record<string, MimeBundle> = {}

/** Markdown longer than this shows as plain text; real prose is far shorter, and parsers slow down. */
const MAX_MARKDOWN_CHARACTERS = 100_000

function NotebookMarkdown({ source, attachments = NO_ATTACHMENTS }: { source: string; attachments?: Record<string, MimeBundle> }) {
  const transform = useMemo(() => notebookUrlTransform(attachments), [attachments])
  if (source.length > MAX_MARKDOWN_CHARACTERS) return <pre className="font-mono text-xs whitespace-pre-wrap break-words">{source}</pre>
  return <Markdown content={source} components={NOTEBOOK_MARKDOWN_COMPONENTS} urlTransform={transform} html />
}

function Prompt({ kind, count }: { kind: 'in' | 'out'; count: number | null }) {
  if (count === null && kind === 'out') return <div className="w-10 shrink-0 sm:w-14" />
  return (
    <div className={cn('w-10 shrink-0 pt-2 text-right font-mono text-[11px] tabular-nums sm:w-14', kind === 'in' ? 'text-muted-foreground' : 'text-primary/80')}>
      [{count ?? ' '}]:
    </div>
  )
}

function OutputBody({ output, dark }: { output: NotebookOutput; dark: boolean }) {
  if (output.type === 'stream') {
    return (
      <pre className={cn('overflow-x-auto rounded-md px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words', output.name === 'stderr' ? 'bg-destructive/10' : '')} data-output="stream">
        <LongText text={output.text}>{(text) => <AnsiText text={text} />}</LongText>
      </pre>
    )
  }
  if (output.type === 'error') {
    const text = output.traceback.length ? output.traceback.join('\n') : `${output.ename}: ${output.evalue}`
    return (
      <pre className="overflow-x-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs leading-5 whitespace-pre" data-output="error">
        <AnsiText text={text} />
      </pre>
    )
  }
  const mime = pickOutputMime(output.data, SUPPORTED_OUTPUTS)
  const data = mime ? output.data[mime] : undefined
  switch (mime) {
    case 'application/vnd.jupyter.widget-view+json': {
      const plain = output.data['text/plain']
      return (
        <p className="px-3 py-2 text-xs text-muted-foreground" data-output="widget">
          {typeof plain === 'string' && plain.trim() ? plain : ui("Interactive widgets need a running kernel and are not shown.")}
        </p>
      )
    }
    case 'text/html':
    case 'application/javascript': {
      // HTML and scripts run only in the opaque-origin sandbox, sized to their content.
      const body = mime === 'text/html' ? String(data) : `<script>${String(data).replace(/<\/script/gi, '<\\/script')}</script>`
      const code = `<!doctype html><html><head><meta charset="utf-8"><style>${outputFrameCss(dark)}</style></head><body>${body}</body></html>`
      return (
        <WhenVisible placeholderHeight={120}>
          <div className="overflow-hidden rounded-md border" data-output="html">
            <SandboxFrame key={dark ? 'dark' : 'light'} kind="html" code={code} title={ui("Notebook output")} fit={{ minHeight: 32, maxHeight: 1600 }} />
          </div>
        </WhenVisible>
      )
    }
    case 'image/svg+xml': {
      // As an <img>, an SVG cannot run scripts or load anything.
      const url = svgDataUrl(data)
      return url ? <img src={url} alt="" className="max-w-full rounded bg-white" data-output="image" /> : null
    }
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp': {
      const url = imageDataUrl(mime, data)
      const width = typeof output.metadata[mime] === 'object' && output.metadata[mime] !== null ? (output.metadata[mime] as { width?: unknown }).width : undefined
      return url ? <img src={url} alt="" className="max-w-full" style={typeof width === 'number' ? { width } : undefined} data-output="image" /> : null
    }
    case 'text/markdown':
      return <div className="px-1 text-sm" data-output="markdown"><NotebookMarkdown source={String(data)} /></div>
    case 'text/latex': {
      const tex = String(data).trim()
      // LaTeX output is usually already delimited ($…$); bare TeX and environments get display delimiters.
      const source = /^\$|^\\\[/.test(tex) ? tex : `$$\n${tex}\n$$`
      return <div className="overflow-x-auto px-1 text-sm" data-output="latex"><Markdown content={source} /></div>
    }
    case 'application/json':
      return (
        <pre className="code-highlight overflow-x-auto rounded-md bg-code px-3 py-2 font-mono text-xs leading-5" data-output="json">
          <HighlightedCode code={outputText(mime, data)} language="json" />
        </pre>
      )
    case 'text/plain':
      return (
        <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-5 whitespace-pre" data-output="text">
          <LongText text={String(data)}>{(text) => <AnsiText text={text} />}</LongText>
        </pre>
      )
    default: {
      const types = Object.keys(output.data)
      return types.length ? <p className="px-3 py-2 text-xs text-muted-foreground">{uit`This output type can't be shown: ${types.join(', ')}`}</p> : null
    }
  }
}

const Cell = memo(function Cell({ cell, language, dark }: { cell: NotebookCell; language: string; dark: boolean }) {
  if (cell.type === 'markdown') {
    return (
      <section className="pl-10 text-sm sm:pl-14 [content-visibility:auto]" data-cell="markdown">
        {cell.source.trim() ? <NotebookMarkdown source={cell.source} attachments={cell.attachments} /> : null}
      </section>
    )
  }
  if (cell.type === 'raw') {
    return (
      <section className="pl-10 sm:pl-14" data-cell="raw">
        <pre className="overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{cell.source}</pre>
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-1.5 [content-visibility:auto]" data-cell="code">
      <div className="flex min-w-0 gap-2">
        <Prompt kind="in" count={cell.executionCount} />
        <pre className="code-highlight min-w-0 flex-1 overflow-x-auto rounded-lg border bg-code px-3 py-2 font-mono text-xs leading-5 text-code-foreground">
          <HighlightedCode code={cell.source} language={language} />
        </pre>
      </div>
      {cell.outputs.map((output, index) => (
        <div key={index} className="flex min-w-0 gap-2">
          <Prompt kind="out" count={output.type === 'execute_result' ? output.executionCount : null} />
          <div className="min-w-0 flex-1 overflow-x-auto">
            <OutputBody output={output} dark={dark} />
          </div>
        </div>
      ))}
    </section>
  )
})

function NotebookBody({ notebook }: { notebook: NotebookModel }) {
  // One theme subscription for the notebook; HTML outputs are styled to match it.
  const dark = useDarkTheme()
  const language = notebook.language ?? 'python'
  if (!notebook.cells.length) return <p className="p-8 text-center text-sm text-muted-foreground">{ui("This notebook has no cells.")}</p>
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-5 sm:px-6">
      {notebook.cells.map((cell) => <Cell key={cell.id} cell={cell} language={language} dark={dark} />)}
    </div>
  )
}

/**
 * A Jupyter notebook, read-only: Markdown cells with math, highlighted code cells with their
 * execution counts, and every common output type. HTML and JavaScript outputs run only in the
 * opaque-origin sandbox. A notebook that cannot be read shows why, with its text below.
 */
export function NotebookViewer({ text, name }: { text: string; name: string }) {
  const parsed = useMemo((): { notebook: NotebookModel; error: null } | { notebook: null; error: NotebookError } => {
    try {
      return { notebook: parseNotebook(text), error: null }
    } catch (cause) {
      return { notebook: null, error: cause instanceof NotebookError ? cause : new NotebookError('not_a_notebook', String(cause)) }
    }
  }, [text])
  const [mode, setMode] = useState<'notebook' | 'source'>('notebook')
  const toggle = (
    <ViewModeToggle
      value={mode}
      onChange={setMode}
      options={[
        { value: 'notebook', label: ui("Show notebook"), icon: BookOpen },
        { value: 'source', label: ui("Show source"), icon: FileJson },
      ]}
    />
  )

  if (!parsed.notebook) {
    const reason = parsed.error.code === 'invalid_json'
      ? ui("This notebook isn't valid JSON, so it can't be shown as a notebook. Its text is below.")
      : parsed.error.code === 'too_large'
        ? ui("This notebook has too many cells to show. Its text is below.")
        : parsed.error.code === 'unsupported_version'
          ? ui("This notebook uses a format version that can't be shown. Its text is below.")
          : ui("This file isn't a Jupyter notebook. Its text is below.")
    return (
      <div className="flex size-full min-h-0 flex-col" data-preview-kind="notebook">
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{reason}</span>
        </div>
        <div className="min-h-0 flex-1">
          <CodeViewer text={text} name={name} language="json" />
        </div>
      </div>
    )
  }
  if (mode === 'source') return <CodeViewer text={text} name={name} language="json" toolbarStart={toggle} />

  const { notebook } = parsed
  const locale = activeLocale()
  return (
    <div className="flex size-full min-h-0 flex-col bg-background" data-preview-kind="notebook">
      <ViewerToolbar>
        {toggle}
        <ViewerStatus>
          {[notebook.kernel ?? notebook.language, notebook.cells.length === 1 ? ui("1 cell") : uit`${notebook.cells.length.toLocaleString(locale)} cells`].filter(Boolean).join(' · ')}
        </ViewerStatus>
        <ViewerToolbarSpacer />
      </ViewerToolbar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NotebookBody notebook={notebook} />
      </div>
    </div>
  )
}
