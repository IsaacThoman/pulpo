import { useState } from 'react'
import { Code2, Eye, RotateCw } from 'lucide-react'
import { SandboxFrame } from '@/components/chat/SandboxFrame'
import { ui, uit } from '@/i18n/ui'
import { CodeViewer } from './CodeViewer'
import { ViewerCopyButton, ViewerIconButton, ViewerToolbar, ViewerToolbarSpacer, ViewModeToggle } from './ViewerChrome'

/**
 * An HTML page or SVG drawing, rendered only in the opaque-origin preview sandbox (it never runs
 * with Pulpo's origin), with its highlighted source one click away.
 */
export function HtmlViewer({ text, name, kind, mimeType }: { text: string; name: string; kind: 'html' | 'svg'; mimeType?: string | null }) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [reloads, setReloads] = useState(0)
  const toggle = (
    <ViewModeToggle
      value={mode}
      onChange={setMode}
      options={[
        { value: 'preview', label: ui("Show preview"), icon: Eye },
        { value: 'source', label: ui("Show source"), icon: Code2 },
      ]}
    />
  )
  if (mode === 'source') return <CodeViewer text={text} name={name} mimeType={mimeType} language="xml" toolbarStart={toggle} />
  return (
    <div className="flex size-full min-h-0 flex-col" data-preview-kind={kind}>
      <ViewerToolbar>
        {toggle}
        <ViewerToolbarSpacer />
        <ViewerIconButton label={ui("Reload preview")} onClick={() => setReloads((count) => count + 1)}>
          <RotateCw className="size-4" />
        </ViewerIconButton>
        <ViewerCopyButton text={() => text} label={ui("Copy code")} />
      </ViewerToolbar>
      <div className="min-h-0 flex-1">
        <SandboxFrame key={reloads} kind={kind} code={text} title={uit`Preview of ${name}`} />
      </div>
    </div>
  )
}
