import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, Loader2 } from 'lucide-react'
import {
  SANDBOX_IFRAME_PERMISSIONS,
  SANDBOX_PATH,
  isSandboxOutboundMessage,
  type CodePreviewKind,
  type SandboxInboundMessage,
} from '@/lib/code-preview'
import { ui, uit } from '@/i18n/ui'

const READY_TIMEOUT_MS = 15_000

/**
 * Renders untrusted HTML/SVG/JSX in an opaque-origin iframe. Remount (change `key`) to render
 * again: each frame accepts exactly one render so no state carries over between previews.
 */
export function SandboxFrame({ kind, code, title }: { kind: CodePreviewKind; code: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<'loading' | 'rendered'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [missingStyles, setMissingStyles] = useState<string[]>([])

  useEffect(() => {
    let sent = false
    const timeout = window.setTimeout(() => {
      if (!sent) setError(ui("The preview sandbox didn't load."))
    }, READY_TIMEOUT_MS)
    const onMessage = (event: MessageEvent) => {
      const target = frameRef.current?.contentWindow
      if (!target || event.source !== target || !isSandboxOutboundMessage(event.data)) return
      const message = event.data
      if (message.type === 'pulpo-sandbox:ready') {
        if (sent) return
        sent = true
        window.clearTimeout(timeout)
        const render: SandboxInboundMessage = { type: 'pulpo-sandbox:render', kind, code }
        // The sandbox's origin is opaque ("null"), so it can only be addressed with "*".
        target.postMessage(render, '*')
      } else if (message.type === 'pulpo-sandbox:rendered') {
        setStatus('rendered')
      } else if (message.type === 'pulpo-sandbox:missing-styles') {
        setMissingStyles(message.files.slice(0, 10).map((file) => file.split('/').pop() || file))
      } else {
        setStatus('rendered')
        setError(message.message.slice(0, 2_000))
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
    }
  }, [code, kind])

  return (
    <div className="relative flex size-full min-h-0 flex-col">
      {error && (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-wrap break-words font-mono">{error}</span>
        </div>
      )}
      {missingStyles.length > 0 && (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{uit`Stylesheet not included: ${missingStyles.join(', ')}. The preview may look unstyled.`}</span>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <iframe
          ref={frameRef}
          src={SANDBOX_PATH}
          title={title}
          sandbox={SANDBOX_IFRAME_PERMISSIONS}
          allow=""
          referrerPolicy="no-referrer"
          className="size-full border-0 bg-white"
          data-testid="sandbox-frame"
        />
        {status === 'loading' && !error && (
          <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-background/60 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {ui("Loading preview…")}
          </div>
        )}
      </div>
    </div>
  )
}
