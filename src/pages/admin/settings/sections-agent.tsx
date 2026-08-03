import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { AgentSettings, WebToolsSettings } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { NumField, SaveBar, SecretField, Section, Toggle } from '@/components/admin/kit'

const defaults: AgentSettings = {
  enabled: false,
  imageDigest: 'ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:' + '0'.repeat(64),
  warmCapacity: 1, maxActiveWorkspaces: 3, cpu: '2', memory: '2048Mi', ephemeralStorage: '20Gi',
  idleTimeoutSeconds: 1800, hardTimeoutSeconds: 14400, workspaceWaitTimeoutSeconds: 900, maxModelTurns: 30, maxToolCalls: 100,
  responseTimeoutSeconds: 1800, commandTimeoutSeconds: 600, maxToolOutputBytes: 100000,
}

type WebToolsForm = WebToolsSettings & { hasApiKey: boolean }
const webDefaults: WebToolsForm = {
  searchEnabled: false, extractEnabled: false, billSearches: false, billExtracts: false,
  searchPriceMicros: 12_000, extractPriceMicros: 4_000, hasApiKey: false,
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
    setWeb({ ...webDefaults, ...webSettings })
  }) }, [])
  const number = (key: keyof AgentSettings, min = 0) => <Input type="number" min={min} value={String(value[key])} onChange={(event) => setValue({ ...value, [key]: Number(event.target.value) })} />
  return <div>
    <Section title="Pi agent mode" hint="The Pulpo worker runs Pi; an external Kubernetes controller owns Kata workspaces and credentials.">
      <Toggle label="Enable agent mode" hint="Models must also be opted in individually." checked={value.enabled} onChange={(enabled) => setValue({ ...value, enabled })} />
      <label className="block space-y-1 text-xs"><span>Immutable workspace image</span><Input className="font-mono text-xs" value={value.imageDigest} onChange={(event) => setValue({ ...value, imageDigest: event.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
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
    </Section>
    <Section title="Kagi web tools" hint="Give agents access to Kagi Search and clean Markdown page extraction. The API key stays encrypted on the Pulpo server.">
      <SecretField label="Kagi API key" hint={web.hasApiKey ? 'Configured — leave blank to keep' : 'Required before either tool can run'} value={kagiApiKey} onChange={setKagiApiKey} />
      <Toggle label="Enable web search" hint="Adds a web_search tool backed by Kagi Search." checked={web.searchEnabled} onChange={(searchEnabled) => setWeb({ ...web, searchEnabled })} />
      <Toggle label="Bill users for searches" checked={web.billSearches} onChange={(billSearches) => setWeb({ ...web, billSearches })} indent />
      {web.billSearches && <NumField label="Price per search" value={web.searchPriceMicros / 1_000_000} onChange={(usd) => setWeb({ ...web, searchPriceMicros: Math.round(usd * 1_000_000) })} min={0} step={0.001} decimals={4} suffix="USD" indent />}
      <Toggle label="Enable page extraction" hint="Adds a web_fetch tool that returns clean page content as Markdown." checked={web.extractEnabled} onChange={(extractEnabled) => setWeb({ ...web, extractEnabled })} />
      <Toggle label="Bill users for page extracts" checked={web.billExtracts} onChange={(billExtracts) => setWeb({ ...web, billExtracts })} indent />
      {web.billExtracts && <NumField label="Price per extracted page" value={web.extractPriceMicros / 1_000_000} onChange={(usd) => setWeb({ ...web, extractPriceMicros: Math.round(usd * 1_000_000) })} min={0} step={0.001} decimals={4} suffix="USD" indent />}
    </Section>
    <div className="mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm">
      {health.healthy ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertCircle className="size-4 text-amber-600" />}
      <span>{health.healthy ? 'Workspace controller is healthy' : health.configured ? health.detail ?? 'Workspace controller is unavailable' : 'Controller URL and token are not configured in deployment secrets'}</span>
    </div>
    <SaveBar onSave={async () => {
      const { hasApiKey: _hasApiKey, ...webSettings } = web
      await Promise.all([
        apiRequest('/api/admin/settings', { method: 'PATCH', body: { agent: value } }),
        apiRequest('/api/admin/settings/web-tools', { method: 'PATCH', body: { ...webSettings, apiKey: kagiApiKey || undefined } }),
      ])
      if (kagiApiKey) setWeb((current) => ({ ...current, hasApiKey: true }))
      setKagiApiKey('')
    }} />
  </div>
}
