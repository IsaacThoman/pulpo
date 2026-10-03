import type { ReactNode } from 'react'
import { Bot, Wrench } from 'lucide-react'
import type { AdminRequestDetail, AdminRequestTimelineItem } from '@pulpo/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCount, formatMicros, formatMs, formatTimestamp } from '@/features/admin-analytics/format'
import { ui, uit } from '@/i18n/ui'
import { DiagnosticAttempts } from '../DiagnosticAttempts'
import { usageRequestSequence } from '../usage-request-sequence'
import { categoryLabel, modelName } from './filters'
import { useRequestDetail } from './queries'
import { StatusBadge } from './StatusBadge'

type Attempt = Extract<AdminRequestTimelineItem, { kind: 'attempt' }>
type Tool = Extract<AdminRequestTimelineItem, { kind: 'tool' }>

function chronological(items: AdminRequestTimelineItem[]): AdminRequestTimelineItem[] {
  return [...items].sort((a, b) => {
    if (!a.startedAt) return b.startedAt ? 1 : 0
    if (!b.startedAt) return -1
    return a.startedAt.localeCompare(b.startedAt)
  })
}

function sequenceLabel(attempt: Attempt): string {
  const position = usageRequestSequence(attempt)
  if (position.kind === 'turn') return uit`Turn ${position.number}`
  if (position.kind === 'compaction') return ui('Compaction')
  return uit`Attempt ${position.number}`
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <span><span className="text-muted-foreground">{label}</span> <span className="tabular-nums">{children}</span></span>
}

function ErrorLine({ category, message }: { category?: string | null; message: string | null }) {
  if (!message && !category) return null
  return (
    <div className="mt-1 text-destructive">
      {category && <span className="font-medium">{categoryLabel(category)}: </span>}
      <span className="break-all font-mono">{message}</span>
    </div>
  )
}

function AttemptItem({ item, modelNames }: { item: Attempt; modelNames: Record<string, string> }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{item.purpose.replaceAll('_', ' ')}</span>
        <span>{modelName(modelNames, item.modelId)}</span>
        {item.upstreamModelId && item.upstreamModelId !== item.modelId && <span className="font-mono text-muted-foreground">{item.upstreamModelId}</span>}
        <Badge variant="outline">{sequenceLabel(item)}</Badge>
        <StatusBadge status={item.status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <Fact label={ui('Started')}>{formatTimestamp(item.startedAt)}</Fact>
        <Fact label={ui('First token')}>{formatMs(item.firstTokenMs)}</Fact>
        <Fact label={ui('Duration')}>{formatMs(item.durationMs)}</Fact>
        <Fact label={ui('Tokens')}>{uit`${formatCount(item.inputTokens)} in / ${formatCount(item.outputTokens)} out`}</Fact>
        <Fact label={ui('Cost')}>{formatMicros(item.costMicros)}</Fact>
      </div>
      {(item.retryReason || item.fallbackFromModelId) && (
        <div className="mt-1 text-muted-foreground">
          {item.retryReason && <span>{uit`Retry reason: ${item.retryReason}`} </span>}
          {item.fallbackFromModelId && <span>{uit`Fell back from ${modelName(modelNames, item.fallbackFromModelId)}`}</span>}
        </div>
      )}
      <ErrorLine category={item.errorCategory} message={item.errorMessage} />
    </>
  )
}

function ToolItem({ item }: { item: Tool }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium font-mono">{item.toolName}</span>
        {item.provider && <span className="text-muted-foreground">{item.provider}</span>}
        <StatusBadge status={item.status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {item.startedAt && <Fact label={ui('Started')}>{formatTimestamp(item.startedAt)}</Fact>}
        <Fact label={ui('Cost')}>{formatMicros(item.billedCostMicros)}</Fact>
      </div>
      <ErrorLine message={item.error} />
    </>
  )
}

function Timeline({ items, modelNames }: { items: AdminRequestTimelineItem[]; modelNames: Record<string, string> }) {
  if (!items.length) return <p className="text-muted-foreground">{ui('No attempts recorded.')}</p>
  return (
    <ol className="space-y-2 border-l pl-4">
      {chronological(items).map((item) => (
        <li key={`${item.kind}:${item.id}`} className="relative">
          <span className="absolute top-0.5 -left-[1.4rem] rounded-full bg-background p-0.5 text-muted-foreground" aria-hidden>
            {item.kind === 'attempt' ? <Bot className="size-3.5" /> : <Wrench className="size-3.5" />}
          </span>
          {item.kind === 'attempt' ? <AttemptItem item={item} modelNames={modelNames} /> : <ToolItem item={item} />}
        </li>
      ))}
    </ol>
  )
}

function OcrAttempts({ attempts }: { attempts: AdminRequestDetail['ocrAttempts'] }) {
  return (
    <ul className="space-y-1">
      {attempts.map((attempt) => (
        <li key={attempt.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge status={attempt.status} />
          <span>{[attempt.providerId, attempt.modelId].filter(Boolean).join(' · ') || '—'}</span>
          {attempt.cached && <Badge variant="outline">{ui('cached')}</Badge>}
          <Fact label={ui('Duration')}>{formatMs(attempt.durationMs)}</Fact>
          <ErrorLine message={attempt.errorMessage} />
        </li>
      ))}
    </ul>
  )
}

function Settings({ settings }: { settings: NonNullable<AdminRequestDetail['settings']> }) {
  const presets = Object.entries(settings.presetSelections)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Fact label={ui('Branch reason')}>{settings.branchReason ?? '—'}</Fact>
        <Fact label={ui('Client version')}>{settings.clientVersion ?? '—'}</Fact>
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.map(([preset, choice]) => <Badge key={preset} variant="outline">{preset}: {choice}</Badge>)}
        </div>
      )}
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-background p-2 text-[11px]">{JSON.stringify(settings.parameters, null, 2)}</pre>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground uppercase">{title}</h4>
      {children}
    </section>
  )
}

export function RequestDetailPanel({ requestId, modelNames }: { requestId: string; modelNames: Record<string, string> }) {
  const detail = useRequestDetail(requestId)
  if (detail.isPending) return <div className="space-y-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-6 w-full" />)}</div>
  if (detail.isError) {
    return (
      <div role="alert" className="flex items-center gap-3 text-destructive">
        <span>{detail.error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>{ui('Retry')}</Button>
      </div>
    )
  }
  const data = detail.data
  return (
    <div className="space-y-4 text-xs">
      <Section title={ui('Timeline')}><Timeline items={data.timeline} modelNames={modelNames} /></Section>
      {data.ocrAttempts.length > 0 && <Section title={ui('OCR attempts')}><OcrAttempts attempts={data.ocrAttempts} /></Section>}
      {data.settings && <Section title={ui('Settings')}><Settings settings={data.settings} /></Section>}
      <details className="rounded-md border">
        <summary className="cursor-pointer px-3 py-2 font-medium">{ui('Raw JSON')}</summary>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all border-t bg-background p-3 text-[11px]">{JSON.stringify(data, null, 2)}</pre>
      </details>
      <div className="rounded-md border p-3"><DiagnosticAttempts requestId={requestId} /></div>
    </div>
  )
}
