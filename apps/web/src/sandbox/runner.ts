import type { ComponentType } from 'react'
import {
  isSandboxInboundMessage,
  type CodePreviewKind,
  type SandboxOutboundMessage,
} from '@/lib/code-preview'
import { svgDocument, withErrorReporter } from './documents'

/*
 * Runs untrusted preview code. This document is only ever loaded in an iframe sandboxed without
 * `allow-same-origin`, so it has an opaque origin and no access to Pulpo's session. It renders
 * exactly one message from its parent; the parent loads a fresh frame for every render.
 */

const parentOrigin = location.origin

function post(message: SandboxOutboundMessage): void {
  window.parent.postMessage(message, parentOrigin)
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error ?? 'Unknown error')
}

function reportErrors(): void {
  window.addEventListener('error', (event) => post({ type: 'pulpo-sandbox:error', message: event.message || 'Script error' }))
  window.addEventListener('unhandledrejection', (event) => post({ type: 'pulpo-sandbox:error', message: describe(event.reason) }))
}

function writeDocument(html: string): void {
  document.open()
  document.write(withErrorReporter(html, parentOrigin))
  document.close()
  post({ type: 'pulpo-sandbox:rendered' })
}

async function renderJsx(source: string): Promise<void> {
  const { transformJsx, evaluateModule, resolveEntry, usesTailwind } = await import('./transform')
  const compiled = transformJsx(source)
  const [{ loadSandboxModules, loadTailwind }, { mountComponent }] = await Promise.all([import('./modules'), import('./mount')])
  const [modules] = await Promise.all([loadSandboxModules(compiled.imports), usesTailwind(source) ? loadTailwind() : null])
  const exports = evaluateModule(compiled.code, (specifier) => {
    if (!modules.has(specifier)) throw new Error(`"${specifier}" isn't available in previews.`)
    return modules.get(specifier)
  })
  const App = resolveEntry(exports) as ComponentType
  const root = document.getElementById('root')!
  mountComponent(App, root, (error) => post({ type: 'pulpo-sandbox:error', message: describe(error) }))
  post({ type: 'pulpo-sandbox:rendered' })
}

async function render(kind: CodePreviewKind, code: string): Promise<void> {
  if (kind === 'html') return writeDocument(code)
  if (kind === 'svg') return writeDocument(svgDocument(code))
  return renderJsx(code)
}

function start(): void {
  // Refuse to run with a real origin (e.g. opened directly in a tab) or outside a frame.
  if (self.origin !== 'null' || window.parent === window) {
    document.body.textContent = ''
    return
  }
  reportErrors()
  let rendered = false
  const onMessage = (event: MessageEvent) => {
    if (rendered || event.source !== window.parent || event.origin !== parentOrigin) return
    if (!isSandboxInboundMessage(event.data)) return
    rendered = true
    window.removeEventListener('message', onMessage)
    render(event.data.kind, event.data.code).catch((error: unknown) => {
      post({ type: 'pulpo-sandbox:error', message: describe(error) })
    })
  }
  window.addEventListener('message', onMessage)
  post({ type: 'pulpo-sandbox:ready' })
}

start()
