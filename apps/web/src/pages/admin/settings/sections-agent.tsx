import { useEffect, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2 } from 'lucide-react'
import type { AgentSettings, WebToolProvider } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { NumField, SaveBar, SecretField, Section, TextField, Toggle } from '@/components/admin/kit'
import { moveWebProvider, webToolsPatchBody, type WebToolsForm } from './web-tools-form'

const defaults: AgentSettings = {
  enabled: false,
  generationConcurrency: 8,
  imageDigest: 'ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:' + '0'.repeat(64),
  warmCapacity: 1, maxActiveWorkspaces: 3, cpu: '2', memory: '2048Mi', ephemeralStorage: '20Gi',
  idleTimeoutSeconds: 1800, hardTimeoutSeconds: 14400, workspaceWaitTimeoutSeconds: 900, maxModelTurns: 30, maxToolCalls: 100,
  responseTimeoutSeconds: 1800, commandTimeoutSeconds: 600, maxToolOutputBytes: 100000,
}

const webDefaults: WebToolsForm = {
  searchEnabled: false, extractEnabled: false,
  searchProviderOrder: ['kagi', 'firecrawl'], extractProviderOrder: ['kagi', 'firecrawl'],
  kagi: {
    searchEnabled: true, billSearches: false, searchPriceMicros: 12_000,
    extractEnabled: true, billExtracts: false, extractPriceMicros: 4_000, hasApiKey: false,
  },
  firecrawl: {
    searchEnabled: false, billSearches: false, searchPriceMicros: 12_000,
    extractEnabled: false, billExtracts: false, extractPriceMicros: 4_000,
    baseUrl: 'https://api.firecrawl.dev/v2', maxAgeSeconds: 0, hasApiKey: false,
  },
}

const providerLabel: Record<WebToolProvider, string> = { kagi: 'Kagi', firecrawl: 'Firecrawl' }

function ProviderOrder({ label, hint, value, onChange }: {
  label: string
  hint: string
  value: WebToolProvider[]
  onChange: (value: WebToolProvider[]) => void
}) {
  return <div className="flex items-start justify-between gap-6">
    <div className="min-w-0"><div className="text-sm">{label}</div><div className="mt-0.5 text-xs text-muted-foreground">{hint}</div></div>
    <div className="w-56 space-y-2">
      {value.map((provider, index) => <div key={provider} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-sm">
        <span><span className="mr-2 text-xs tabular-nums text-muted-foreground">{index + 1}</span>{providerLabel[provider]}</span>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label={`Move ${providerLabel[provider]} earlier`} onClick={() => onChange(moveWebProvider(value, index, -1))}><ArrowUp /></Button>
          <Button type="button" variant="ghost" size="icon-sm" disabled={index === value.length - 1} aria-label={`Move ${providerLabel[provider]} later`} onClick={() => onChange(moveWebProvider(value, index, 1))}><ArrowDown /></Button>
        </div>
      </div>)}
    </div>
  </div>
}

function firecrawlCloudRequiresKey(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname.toLowerCase() === 'api.firecrawl.dev' } catch { return true }
}

function memoryMiB(quantity: string): number {
  const match = quantity.trim().match(/^([1-9]\d*)(Mi|Gi)$/)
  if (!match) return 2048
  return Number(match[1]) * (match[2] === 'Gi' ? 1024 : 1)
}

function cpuCores(quantity: string): number {
  const millicores = quantity.trim().match(/^([1-9]\d*)m$/)
  if (millicores) return Number(millicores[1]) / 1000
  const cores = Number(quantity)
  return Number.isFinite(cores) && cores > 0 ? cores : 2
}

function diskGiB(quantity: string): number {
  const match = quantity.trim().match(/^([1-9]\d*)(Mi|Gi)$/)
  if (!match) return 20
  return match[2] === 'Mi' ? Math.ceil(Number(match[1]) / 1024) : Number(match[1])
}

export function AgentSection() {
  const [value, setValue] = useState(defaults)
  const [web, setWeb] = useState(webDefaults)
  const [kagiApiKey, setKagiApiKey] = useState('')
  const [firecrawlApiKey, setFirecrawlApiKey] = useState('')
  const [health, setHealth] = useState<{ configured: boolean; healthy: boolean; detail?: string }>({ configured: false, healthy: false })
  useEffect(() => { void Promise.all([
    apiRequest<{ values: { agent?: Partial<AgentSettings> } }>('/api/admin/settings'),
    apiRequest<{ configured: boolean; healthy: boolean; detail?: string }>('/api/admin/settings/agent/status'),
    apiRequest<WebToolsForm>('/api/admin/settings/web-tools'),
  ]).then(([settings, status, webSettings]) => {
    const loaded = { ...defaults, ...settings.values.agent }
    setValue({
      ...loaded,
      cpu: String(cpuCores(loaded.cpu)),
      memory: `${memoryMiB(loaded.memory)}Mi`,
      ephemeralStorage: `${diskGiB(loaded.ephemeralStorage)}Gi`,
    })
    setHealth(status)
    setWeb({
      ...webDefaults,
      ...webSettings,
      kagi: { ...webDefaults.kagi, ...webSettings.kagi },
      firecrawl: { ...webDefaults.firecrawl, ...webSettings.firecrawl },
    })
  }) }, [])
  const number = (key: keyof AgentSettings, min = 0) => <Input type="number" min={min} value={String(value[key])} onChange={(event) => setValue({ ...value, [key]: Number(event.target.value) })} />
  const kagiAvailable = web.kagi.hasApiKey || Boolean(kagiApiKey.trim())
  const firecrawlAvailable = !firecrawlCloudRequiresKey(web.firecrawl.baseUrl) || web.firecrawl.hasApiKey || Boolean(firecrawlApiKey.trim())
  const capabilityAvailable = (capability: 'search' | 'extract') => web[capability === 'search' ? 'searchProviderOrder' : 'extractProviderOrder'].some((provider) => (
    web[provider][capability === 'search' ? 'searchEnabled' : 'extractEnabled']
    && (provider === 'kagi' ? kagiAvailable : firecrawlAvailable)
  ))
  return <div>
    <Section title="Pi agent mode" hint="The Pulpo worker runs Pi; an external Kubernetes controller owns Kata workspaces and credentials.">
      <Toggle label="Enable agent mode" hint="Models must also be opted in individually." checked={value.enabled} onChange={(enabled) => setValue({ ...value, enabled })} />
      <label className="block space-y-1 text-xs"><span>Immutable workspace image</span><Input className="font-mono text-xs" value={value.imageDigest} onChange={(event) => setValue({ ...value, imageDigest: event.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs"><span>Concurrent responses</span>{number('generationConcurrency', 1)}</label>
        <label className="space-y-1 text-xs"><span>Warm workspaces</span>{number('warmCapacity')}</label>
        <label className="space-y-1 text-xs"><span>Maximum active workspaces</span>{number('maxActiveWorkspaces', 1)}</label>
        <label className="space-y-1 text-xs"><span>CPU (cores)</span><Input type="number" min={0.001} step={0.1} value={cpuCores(value.cpu)} onChange={(event) => {
          if (Number.isFinite(event.target.valueAsNumber) && event.target.valueAsNumber > 0) setValue({ ...value, cpu: String(event.target.valueAsNumber) })
        }} /></label>
        <label className="space-y-1 text-xs"><span>Memory (MiB)</span><Input type="number" min={1} step={128} value={memoryMiB(value.memory)} onChange={(event) => {
          if (Number.isInteger(event.target.valueAsNumber) && event.target.valueAsNumber > 0) setValue({ ...value, memory: `${event.target.valueAsNumber}Mi` })
        }} /></label>
        <label className="space-y-1 text-xs"><span>Ephemeral disk (GiB)</span><Input type="number" min={1} step={1} value={diskGiB(value.ephemeralStorage)} onChange={(event) => {
          if (Number.isInteger(event.target.valueAsNumber) && event.target.valueAsNumber > 0) setValue({ ...value, ephemeralStorage: `${event.target.valueAsNumber}Gi` })
        }} /></label>
        <label className="space-y-1 text-xs"><span>Idle timeout (seconds)</span>{number('idleTimeoutSeconds', 60)}</label>
        <label className="space-y-1 text-xs"><span>Hard timeout (seconds)</span>{number('hardTimeoutSeconds', 300)}</label>
        <label className="space-y-1 text-xs"><span>Capacity wait timeout (seconds)</span>{number('workspaceWaitTimeoutSeconds', 30)}</label>
        <label className="space-y-1 text-xs"><span>Maximum model turns</span>{number('maxModelTurns', 1)}</label>
        <label className="space-y-1 text-xs"><span>Maximum tool calls</span>{number('maxToolCalls', 1)}</label>
        <label className="space-y-1 text-xs"><span>Response timeout (seconds)</span>{number('responseTimeoutSeconds', 60)}</label>
        <label className="space-y-1 text-xs"><span>Command timeout (seconds)</span>{number('commandTimeoutSeconds', 1)}</label>
        <label className="space-y-1 text-xs"><span>Retained tool output (bytes)</span>{number('maxToolOutputBytes', 1024)}</label>
      </div>
      <div className="flex items-center gap-2 text-sm">
        {health.healthy ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertCircle className="size-4 text-amber-600" />}
        <span>{health.healthy ? 'Workspace controller is healthy' : health.configured ? health.detail ?? 'Workspace controller is unavailable' : 'Controller URL and token are not configured in deployment secrets'}</span>
      </div>
    </Section>
    <Section title="Web tools" hint="Control global agent web capabilities and the order in which enabled providers are attempted.">
      <Toggle label="Enable web search" hint="Adds the web_search tool when at least one search provider is available." checked={web.searchEnabled} onChange={(searchEnabled) => setWeb({ ...web, searchEnabled })} />
      <ProviderOrder label="Search fallback order" hint="The first enabled provider returning results wins." value={web.searchProviderOrder} onChange={(searchProviderOrder) => setWeb({ ...web, searchProviderOrder })} />
      <Toggle label="Enable page extraction" hint="Adds the web_fetch tool when at least one extraction provider is available." checked={web.extractEnabled} onChange={(extractEnabled) => setWeb({ ...web, extractEnabled })} />
      <ProviderOrder label="Extraction fallback order" hint="Empty content and provider failures advance to the next provider." value={web.extractProviderOrder} onChange={(extractProviderOrder) => setWeb({ ...web, extractProviderOrder })} />
      {web.searchEnabled && !capabilityAvailable('search') && <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertCircle className="size-4" />Web search is enabled, but no usable search provider is configured.</div>}
      {web.extractEnabled && !capabilityAvailable('extract') && <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertCircle className="size-4" />Page extraction is enabled, but no usable extraction provider is configured.</div>}
    </Section>
    <Section title="Kagi" hint="Use Kagi Search and Extract as one provider in the web-tool fallback chains.">
      <SecretField label="Kagi API key" hint={web.kagi.hasApiKey ? 'Configured — leave blank to keep' : 'Required before Kagi can run'} value={kagiApiKey} onChange={setKagiApiKey} />
      <Toggle label="Use for web search" checked={web.kagi.searchEnabled} onChange={(searchEnabled) => setWeb({ ...web, kagi: { ...web.kagi, searchEnabled } })} />
      <Toggle label="Bill users for Kagi searches" checked={web.kagi.billSearches} onChange={(billSearches) => setWeb({ ...web, kagi: { ...web.kagi, billSearches } })} indent />
      {web.kagi.billSearches && <NumField label="Price per Kagi search" value={web.kagi.searchPriceMicros / 1_000_000} onChange={(usd) => setWeb({ ...web, kagi: { ...web.kagi, searchPriceMicros: Math.round(usd * 1_000_000) } })} min={0} step={0.001} decimals={4} suffix="USD" indent />}
      <Toggle label="Use for page extraction" checked={web.kagi.extractEnabled} onChange={(extractEnabled) => setWeb({ ...web, kagi: { ...web.kagi, extractEnabled } })} />
      <Toggle label="Bill users for Kagi page extracts" checked={web.kagi.billExtracts} onChange={(billExtracts) => setWeb({ ...web, kagi: { ...web.kagi, billExtracts } })} indent />
      {web.kagi.billExtracts && <NumField label="Price per Kagi page extract" value={web.kagi.extractPriceMicros / 1_000_000} onChange={(usd) => setWeb({ ...web, kagi: { ...web.kagi, extractPriceMicros: Math.round(usd * 1_000_000) } })} min={0} step={0.001} decimals={4} suffix="USD" indent />}
      {((web.searchEnabled && web.kagi.searchEnabled) || (web.extractEnabled && web.kagi.extractEnabled)) && !kagiAvailable && <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertCircle className="size-4" />Kagi is enabled but will be skipped until an API key is configured.</div>}
    </Section>
    <Section title="Firecrawl" hint="Use Firecrawl Cloud or a v2-compatible self-hosted endpoint. Secrets remain encrypted on the Pulpo server.">
      <TextField label="API base URL" hint="Private endpoints require ALLOW_PRIVATE_PROVIDER_URLS=true." value={web.firecrawl.baseUrl} onChange={(baseUrl) => setWeb({ ...web, firecrawl: { ...web.firecrawl, baseUrl } })} mono />
      <SecretField label="Firecrawl API key" hint={web.firecrawl.hasApiKey ? 'Configured — leave blank to keep' : firecrawlCloudRequiresKey(web.firecrawl.baseUrl) ? 'Required for Firecrawl Cloud' : 'Optional for this custom endpoint'} value={firecrawlApiKey} onChange={setFirecrawlApiKey} />
      <Toggle label="Use for web search" checked={web.firecrawl.searchEnabled} onChange={(searchEnabled) => setWeb({ ...web, firecrawl: { ...web.firecrawl, searchEnabled } })} />
      <Toggle label="Bill users for Firecrawl searches" checked={web.firecrawl.billSearches} onChange={(billSearches) => setWeb({ ...web, firecrawl: { ...web.firecrawl, billSearches } })} indent />
      {web.firecrawl.billSearches && <NumField label="Price per Firecrawl search" value={web.firecrawl.searchPriceMicros / 1_000_000} onChange={(usd) => setWeb({ ...web, firecrawl: { ...web.firecrawl, searchPriceMicros: Math.round(usd * 1_000_000) } })} min={0} step={0.001} decimals={4} suffix="USD" indent />}
      <Toggle label="Use for page extraction" checked={web.firecrawl.extractEnabled} onChange={(extractEnabled) => setWeb({ ...web, firecrawl: { ...web.firecrawl, extractEnabled } })} />
      <Toggle label="Bill users for Firecrawl page extracts" checked={web.firecrawl.billExtracts} onChange={(billExtracts) => setWeb({ ...web, firecrawl: { ...web.firecrawl, billExtracts } })} indent />
      {web.firecrawl.billExtracts && <NumField label="Price per Firecrawl page extract" value={web.firecrawl.extractPriceMicros / 1_000_000} onChange={(usd) => setWeb({ ...web, firecrawl: { ...web.firecrawl, extractPriceMicros: Math.round(usd * 1_000_000) } })} min={0} step={0.001} decimals={4} suffix="USD" indent />}
      <NumField label="Maximum scrape cache age" hint="0 always requests fresh content." value={web.firecrawl.maxAgeSeconds} onChange={(maxAgeSeconds) => setWeb({ ...web, firecrawl: { ...web.firecrawl, maxAgeSeconds: Math.round(maxAgeSeconds) } })} min={0} max={31_536_000} step={60} suffix="seconds" />
      {((web.searchEnabled && web.firecrawl.searchEnabled) || (web.extractEnabled && web.firecrawl.extractEnabled)) && !firecrawlAvailable && <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertCircle className="size-4" />Firecrawl Cloud is enabled but will be skipped until an API key is configured.</div>}
    </Section>
    <SaveBar onSave={async () => {
      const [, savedWeb] = await Promise.all([
        apiRequest('/api/admin/settings', { method: 'PATCH', body: { agent: value } }),
        apiRequest<WebToolsForm>('/api/admin/settings/web-tools', {
          method: 'PATCH',
          body: webToolsPatchBody(web, kagiApiKey, firecrawlApiKey),
        }),
      ])
      setWeb({
        ...webDefaults,
        ...savedWeb,
        kagi: { ...webDefaults.kagi, ...savedWeb.kagi },
        firecrawl: { ...webDefaults.firecrawl, ...savedWeb.firecrawl },
      })
      setKagiApiKey('')
      setFirecrawlApiKey('')
    }} />
  </div>
}
