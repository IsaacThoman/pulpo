import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Check, Copy } from 'lucide-react'
import 'katex/dist/katex.min.css'

/** Convert \( \) / \[ \] (common in LLM output) to $ / $$ for remark-math. Skip fenced/inline code. */
function normalizeMathDelimiters(content: string): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part
        .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
        .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_, tex: string) => `$${tex}$`)
    })
    .join('')
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group/code my-3 min-w-0 max-w-full overflow-hidden rounded-lg border bg-zinc-950 dark:bg-zinc-900">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-zinc-400">{language || 'text'}</span>
        <button
          className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100"
          onClick={() => {
            navigator.clipboard?.writeText(code).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto p-3 text-[13px] leading-relaxed text-zinc-100">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}

function useRenderedContent(content: string, streaming: boolean): string {
  const latest = useRef(content)
  latest.current = content
  const [rendered, setRendered] = useState(content)

  useEffect(() => {
    if (!streaming) setRendered(content)
  }, [content, streaming])

  useEffect(() => {
    if (!streaming) return
    const timer = window.setInterval(() => {
      setRendered((current) => current === latest.current ? current : latest.current)
    }, 100)
    return () => window.clearInterval(timer)
  }, [streaming])

  return rendered
}

export const Markdown = memo(function Markdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const rendered = useRenderedContent(content, streaming)
  const normalized = useMemo(() => normalizeMathDelimiters(rendered), [rendered])

  return (
    <div className="markdown-content min-w-0 max-w-full [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: 'var(--muted-foreground)' }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const text = String(children).replace(/\n$/, '')
            if (match?.[1] === 'math') {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            }
            const isBlock = text.includes('\n') || match
            if (!isBlock) {
              return (
                <code
                  className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground [overflow-wrap:anywhere]"
                  {...props}
                >
                  {text}
                </code>
              )
            }
            return <CodeBlock language={match?.[1] ?? ''} code={text} />
          },
          p: ({ children }) => <p className="my-2 leading-7 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
          li: ({ children }) => <li className="leading-7">{children}</li>,
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-xl font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-base font-semibold">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-muted-foreground/30 pl-4 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium [overflow-wrap:anywhere] underline underline-offset-2 hover:text-muted-foreground"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b bg-muted/50 px-3 py-2 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border-b px-3 py-2">{children}</td>,
          hr: () => <hr className="my-4 border-border" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
})
