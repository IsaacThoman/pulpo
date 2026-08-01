import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Check, Copy } from 'lucide-react'
import 'katex/dist/katex.min.css'

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-zinc-950 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[11px] font-medium text-zinc-400">{language || 'text'}</span>
        <button
          className="flex cursor-pointer items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100"
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
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed text-zinc-100">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: 'var(--muted-foreground)' }]]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const text = String(children).replace(/\n$/, '')
          const isBlock = text.includes('\n') || match
          if (!isBlock) {
            return (
              <code
                className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
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
            className="font-medium underline underline-offset-2 hover:text-muted-foreground"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">{children}</table>
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
      {content}
    </ReactMarkdown>
  )
})
