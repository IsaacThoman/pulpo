import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { AgentSettings } from '@pulpo/contracts'
import { apiRequest } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { SaveBar, Section, Toggle } from '@/components/admin/kit'

const defaults: AgentSettings = {
  enabled: false,
  imageDigest: 'ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:' + '0'.repeat(64),
  warmCapacity: 1, maxActiveWorkspaces: 3, cpu: '2', memory: '2048Mi', ephemeralStorage: '20Gi',
  idleTimeoutSeconds: 1800, hardTimeoutSeconds: 14400, workspaceWaitTimeoutSeconds: 900, maxModelTurns: 30, maxToolCalls: 100,
  responseTimeoutSeconds: 1800, commandTimeoutSeconds: 600, maxToolOutputBytes: 100000,
}

function memoryMiB(quantity: string): number {
  const match = quantity.trim().match(/^([1-9]\d*)(Mi|Gi)$/)
  if (!match) return 2048
  return Number(match[1]) * (match[2] === 'Gi' ? 1024 : 1)
}

export function AgentSection() {
  const [value, setValue] = useState(defaults)
  const [health, setHealth] = useState<{ configured: boolean; healthy: boolean; detail?: string }>({ configured: false, healthy: false })
  useEffect(() => { void Promise.all([
    apiRequest<{ values: { agent?: Partial<AgentSettings> } }>('/api/admin/settings'),
    apiRequest<{ configured: boolean; healthy: boolean; detail?: string }>('/api/admin/settings/agent/status'),
  ]).then(([settings, status]) => {
    const loaded = { ...defaults, ...settings.values.agent }
    setValue({ ...loaded, memory: `${memoryMiB(loaded.memory)}Mi` })
    setHealth(status)
  }) }, [])
  const number = (key: keyof AgentSettings, min = 0) => <Input type="number" min={min} value={String(value[key])} onChange={(event) => setValue({ ...value, [key]: Number(event.target.value) })} />
  return <div>
    <Section title="Pi agent mode" hint="The Pulpo worker runs Pi; an external Kubernetes controller owns Kata workspaces and credentials.">
      <Toggle label="Enable agent mode" hint="Models must also be opted in individually." checked={value.enabled} onChange={(enabled) => setValue({ ...value, enabled })} />
      <label className="block space-y-1 text-xs"><span>Immutable workspace image</span><Input className="font-mono text-xs" value={value.imageDigest} onChange={(event) => setValue({ ...value, imageDigest: event.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs"><span>Warm workspaces</span>{number('warmCapacity')}</label>
        <label className="space-y-1 text-xs"><span>Maximum active</span>{number('maxActiveWorkspaces', 1)}</label>
        <label className="space-y-1 text-xs"><span>CPU</span><Input value={value.cpu} onChange={(event) => setValue({ ...value, cpu: event.target.value })} /></label>
        <label className="space-y-1 text-xs"><span>Memory (MiB)</span><Input type="number" min={1} step={128} value={memoryMiB(value.memory)} onChange={(event) => {
          if (Number.isInteger(event.target.valueAsNumber) && event.target.valueAsNumber > 0) setValue({ ...value, memory: `${event.target.valueAsNumber}Mi` })
        }} /></label>
        <label className="space-y-1 text-xs"><span>Ephemeral disk</span><Input value={value.ephemeralStorage} onChange={(event) => setValue({ ...value, ephemeralStorage: event.target.value })} /></label>
        <label className="space-y-1 text-xs"><span>Idle timeout (seconds)</span>{number('idleTimeoutSeconds', 60)}</label>
        <label className="space-y-1 text-xs"><span>Hard timeout (seconds)</span>{number('hardTimeoutSeconds', 300)}</label>
        <label className="space-y-1 text-xs"><span>Capacity wait timeout (seconds)</span>{number('workspaceWaitTimeoutSeconds', 30)}</label>
        <label className="space-y-1 text-xs"><span>Maximum model turns</span>{number('maxModelTurns', 1)}</label>
        <label className="space-y-1 text-xs"><span>Maximum tool calls</span>{number('maxToolCalls', 1)}</label>
        <label className="space-y-1 text-xs"><span>Response timeout (seconds)</span>{number('responseTimeoutSeconds', 60)}</label>
        <label className="space-y-1 text-xs"><span>Command timeout (seconds)</span>{number('commandTimeoutSeconds', 1)}</label>
        <label className="space-y-1 text-xs"><span>Retained tool output bytes</span>{number('maxToolOutputBytes', 1024)}</label>
      </div>
    </Section>
    <div className="mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm">
      {health.healthy ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertCircle className="size-4 text-amber-600" />}
      <span>{health.healthy ? 'Workspace controller is healthy' : health.configured ? health.detail ?? 'Workspace controller is unavailable' : 'Controller URL and token are not configured in deployment secrets'}</span>
    </div>
    <SaveBar onSave={() => apiRequest('/api/admin/settings', { method: 'PATCH', body: { agent: value } })} />
  </div>
}
