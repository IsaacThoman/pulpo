import { useEffect, useState } from 'react'
import { Check, Code2, Copy, Download, Eye, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HighlightedCode } from '@/components/chat/HighlightedCode'
import { SandboxFrame } from '@/components/chat/SandboxFrame'
import { previewFileName, previewKindLabel, previewMimeType } from '@/lib/code-preview'
import { downloadCode } from '@/lib/code-download'
import { languageForPreviewKind } from '@/lib/syntax-highlight'
import { writeClipboardText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { useCodePreview, type CodePreview } from '@/stores/codePreview'
import { ui } from '@/i18n/ui'

export function CodeSource({ code, language }: { code: string; language?: string | null }) {
  return (
    <div className="size-full overflow-auto bg-code text-code-foreground" data-preview-kind="source">
      <pre className="code-highlight min-h-full p-5 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
        <HighlightedCode code={code} language={language} />
      </pre>
    </div>
  )
}

export function PreviewModeToggle({ mode, onChange }: { mode: 'preview' | 'code'; onChange: (mode: 'preview' | 'code') => void }) {
  const option = (value: 'preview' | 'code', label: string, Icon: typeof Eye) => (
    <button
      type="button"
      aria-pressed={mode === value}
      aria-label={label}
      onClick={() => onChange(value)}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground',
        mode === value && 'bg-background text-foreground shadow-sm',
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {option('preview', ui("Show preview"), Eye)}
      {option('code', ui("Show code"), Code2)}
    </div>
  )
}

function PanelBody({ preview }: { preview: CodePreview }) {
  const close = useCodePreview((state) => state.close)
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [reloads, setReloads] = useState(0)
  const [copied, setCopied] = useState(false)

  return (
    <>
      <header className="flex h-12 min-w-0 shrink-0 items-center gap-2 border-b px-3">
        <PreviewModeToggle mode={mode} onChange={setMode} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="min-w-0 truncate text-sm font-medium">{preview.title}</h2>
          <span className="shrink-0 text-xs text-muted-foreground">{previewKindLabel(preview.kind)}</span>
        </div>
        {mode === 'preview' && (
          <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={ui("Reload preview")} onClick={() => setReloads((count) => count + 1)}>
            <RotateCw className="size-4" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label={copied ? ui("Copied") : ui("Copy code")}
          onClick={() => {
            void writeClipboardText(preview.code).then((success) => {
              if (!success) return
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={ui("Download code")} onClick={() => downloadCode(preview.code, previewFileName(preview.title, preview.kind), previewMimeType(preview.kind))}>
          <Download className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={ui("Close preview")} onClick={close}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'preview'
          ? <SandboxFrame key={reloads} kind={preview.kind} code={preview.code} title={preview.title} />
          : <CodeSource code={preview.code} language={languageForPreviewKind(preview.kind)} />}
      </div>
    </>
  )
}

/**
 * Side panel for previews opened from chat code blocks. `docked` sits beside the chat column in a
 * flex row; `overlay` floats over scrolling pages. Both take the full screen on narrow viewports.
 */
export function CodePreviewPanel({ variant = 'docked' }: { variant?: 'docked' | 'overlay' }) {
  const preview = useCodePreview((state) => state.preview)
  useEffect(() => useCodePreview.getState().attachHost(), [])
  if (!preview) return null
  return (
    <aside
      aria-label={ui("Code preview")}
      data-testid="code-preview-panel"
      className={cn(
        'fixed inset-0 z-50 flex min-w-0 flex-col bg-background',
        variant === 'docked'
          ? 'lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-[min(50%,48rem)] lg:shrink-0 lg:border-l'
          : 'lg:left-auto lg:w-[min(50vw,48rem)] lg:border-l lg:shadow-2xl',
      )}
    >
      {/* Re-key on content so switching previews resets the mode and reload state. */}
      <PanelBody key={`${preview.kind}:${preview.title}:${preview.code}`} preview={preview} />
    </aside>
  )
}
