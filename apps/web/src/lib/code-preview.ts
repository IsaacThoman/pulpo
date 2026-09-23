/** Content that can run inside the isolated preview sandbox. */
export type CodePreviewKind = 'html' | 'svg' | 'jsx'

const LANGUAGE_KINDS: Record<string, CodePreviewKind> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  jsx: 'jsx',
  tsx: 'jsx',
  react: 'jsx',
}

const EXTENSION_KINDS: Record<string, CodePreviewKind> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  jsx: 'jsx',
  tsx: 'jsx',
}

export function previewKindForLanguage(language: string, code = ''): CodePreviewKind | null {
  const normalized = language.trim().toLowerCase()
  const kind = LANGUAGE_KINDS[normalized]
  if (kind) return kind
  if (normalized === 'xml' && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(code)) return 'svg'
  return null
}

export function previewKindForFile(name: string, mimeType = ''): CodePreviewKind | null {
  const extension = name.trim().toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1]
  if (extension && EXTENSION_KINDS[extension]) return EXTENSION_KINDS[extension]
  const mime = mimeType.toLowerCase()
  if (mime === 'text/html') return 'html'
  if (mime === 'image/svg+xml') return 'svg'
  return null
}

export function previewKindLabel(kind: CodePreviewKind): string {
  return kind.toUpperCase()
}

/** A human title for a snippet: its HTML `<title>`, its default-exported component, or its kind. */
export function previewTitle(kind: CodePreviewKind, code: string): string {
  const title = kind === 'html'
    ? /<title[^>]*>([^<]*)<\/title>/i.exec(code)?.[1]
    : kind === 'jsx'
      ? /export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(code)?.[1]
        ?? /export\s+default\s+([A-Z][\w$]*)\s*;?\s*$/m.exec(code)?.[1]
      : undefined
  return title?.trim().slice(0, 80) || previewKindLabel(kind)
}

export function previewFileName(title: string, kind: CodePreviewKind): string {
  const base = title.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'preview'
  return base.toLowerCase().endsWith(`.${kind}`) ? base : `${base}.${kind}`
}

export function previewMimeType(kind: CodePreviewKind): string {
  if (kind === 'html') return 'text/html'
  if (kind === 'svg') return 'image/svg+xml'
  return 'text/javascript'
}

/** Messages exchanged with `sandbox.html`. The sandbox has an opaque origin, so every field is validated on both sides. */
export type SandboxInboundMessage = { type: 'pulpo-sandbox:render'; kind: CodePreviewKind; code: string }
export type SandboxOutboundMessage =
  | { type: 'pulpo-sandbox:ready' }
  | { type: 'pulpo-sandbox:rendered' }
  | { type: 'pulpo-sandbox:error'; message: string }

export function isSandboxOutboundMessage(value: unknown): value is SandboxOutboundMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as { type?: unknown; message?: unknown }
  if (message.type === 'pulpo-sandbox:ready' || message.type === 'pulpo-sandbox:rendered') return true
  return message.type === 'pulpo-sandbox:error' && typeof message.message === 'string'
}

export function isSandboxInboundMessage(value: unknown): value is SandboxInboundMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as { type?: unknown; kind?: unknown; code?: unknown }
  return message.type === 'pulpo-sandbox:render'
    && (message.kind === 'html' || message.kind === 'svg' || message.kind === 'jsx')
    && typeof message.code === 'string'
}

export const SANDBOX_PATH = '/sandbox.html'

/**
 * Previews run without `allow-same-origin`, so the document gets an opaque origin and cannot reach
 * Pulpo cookies, storage, the parent DOM, or authenticated API requests.
 */
export const SANDBOX_IFRAME_PERMISSIONS = 'allow-scripts allow-modals allow-popups allow-forms allow-downloads'
