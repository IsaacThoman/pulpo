import { useEffect, useState } from 'react'
import { AlertTriangle, Laptop, Link2, Loader2, RefreshCw, Smartphone, Monitor, Unplug } from 'lucide-react'
import { computerOsLabel, type AgentComputer, type ComputerPairing, type DesktopComputerState } from '@pulpo/contracts'
import { desktopComputerApi, isDesktopRuntime } from '@/lib/runtime'
import { decideComputerPairing, removeComputer, requestComputerPairing, revokeComputerPairing, useAgentComputers, useAgentPairings, useInvalidateComputers } from '@/lib/computers'
import { timeAgo } from '@/lib/format'
import { ui } from '@/i18n/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function statusLabel(state: DesktopComputerState): string {
  if (state.status === 'online') return ui('Connected')
  if (state.status === 'connecting') return ui('Connecting…')
  if (state.status === 'offline') return ui('Offline')
  if (state.status === 'error') return ui('Needs attention')
  return ui('Off')
}

/** Desktop-only card that configures how the agent may use this machine. */
export function ThisComputerCard() {
  const api = desktopComputerApi()
  const [state, setState] = useState<DesktopComputerState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const invalidate = useInvalidateComputers()

  useEffect(() => {
    if (!api) return
    let disposed = false
    void api.getState().then((next) => { if (!disposed) setState(next) }).catch(() => undefined)
    const unsubscribe = api.onStateChanged((next) => { if (!disposed) setState(next) })
    return () => { disposed = true; unsubscribe() }
  }, [api])

  if (!api) return null
  if (!state) return <p role="status" className="text-sm text-muted-foreground">{ui('Loading this computer…')}</p>

  const update = async (patch: Parameters<typeof api.update>[0]) => {
    setBusy(true)
    setError('')
    try {
      setState(await api.update(patch))
      void invalidate()
    } catch (next) {
      setError(next instanceof Error ? next.message : ui('Could not update this computer.'))
    } finally {
      setBusy(false)
    }
  }

  const chooseFolder = async () => {
    const folder = await api.chooseFolder()
    if (folder) await update({ rootPath: folder })
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <Laptop className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{ui('This computer')}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${state.status === 'online' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : state.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-accent text-muted-foreground'}`}>{statusLabel(state)}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {ui('Let the agent read and change files and run commands on this Mac, PC, or Linux machine instead of a cloud sandbox. Everything runs as you, with your permissions, and changes are permanent.')}
          </p>
          {state.error && <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{state.error}</p>}
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <Switch
          checked={state.enabled}
          disabled={busy || (!state.enabled && state.accessMode === 'folder' && !state.rootPath)}
          aria-label={ui('Share this computer with the agent')}
          onCheckedChange={(enabled) => void update({ enabled })}
        />
      </div>
      <Separator className="my-3" />
      <div className="divide-y">
        <Row label={ui('Name')} hint={ui('Shown in the workspace picker on all your devices.')}>
          <Input
            className="h-8 w-48 text-sm"
            value={nameDraft ?? state.name}
            disabled={busy}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => { if (nameDraft !== null && nameDraft.trim() && nameDraft.trim() !== state.name) void update({ name: nameDraft.trim() }); setNameDraft(null) }}
          />
        </Row>
        <Row label={ui('Access')} hint={state.accessMode === 'folder'
          ? ui('File tools are limited to the chosen folder. Shell commands start there but are not sandboxed by the operating system.')
          : ui('The agent can reach anything your user account can. Prefer folder access unless you need the whole machine.')}
        >
          <Select value={state.accessMode} disabled={busy} onValueChange={(accessMode) => void update({ accessMode: accessMode as DesktopComputerState['accessMode'] })}>
            <SelectTrigger className="h-8 w-48 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="folder">{ui('One folder')}</SelectItem>
              <SelectItem value="full">{ui('Whole computer')}</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        {state.accessMode === 'folder' && (
          <Row label={ui('Folder')} hint={state.rootPath ?? ui('No folder chosen yet.')}>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void chooseFolder()}>{state.rootPath ? ui('Change…') : ui('Choose…')}</Button>
          </Row>
        )}
        <Row label={ui('Ask before')} hint={ui('Approve or deny requests in the chat. Reads never need approval.')}>
          <Select value={state.approvalPolicy} disabled={busy} onValueChange={(approvalPolicy) => void update({ approvalPolicy: approvalPolicy as DesktopComputerState['approvalPolicy'] })}>
            <SelectTrigger className="h-8 w-48 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{ui('Commands and file changes')}</SelectItem>
              <SelectItem value="bash-only">{ui('Commands only')}</SelectItem>
              <SelectItem value="never">{ui('Never ask')}</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label={ui('Allow other devices')} hint={ui('Your phone or browser can use this computer after you approve a pairing request here.')}>
          <Switch checked={state.allowRemote} disabled={busy} aria-label={ui('Allow other devices')} onCheckedChange={(allowRemote) => void update({ allowRemote })} />
        </Row>
      </div>
    </div>
  )
}

function ComputerRow({ computer, pairings, onChanged }: { computer: AgentComputer; pairings: ComputerPairing[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try { await task(); await onChanged() } catch (next) { setError(next instanceof Error ? next.message : ui('Something went wrong.')) } finally { setBusy(false) }
  }
  const status = !computer.enabled ? ui('Turned off') : computer.online ? ui('Online') : computer.lastSeenAt ? ui('Last seen {{when}}', { when: timeAgo(Date.parse(computer.lastSeenAt)) }) : ui('Offline')
  const access = computer.accessMode === 'folder' ? ui('Folder: {{path}}', { path: computer.rootPath }) : ui('Whole computer')
  const canRequest = !computer.isOwnedByThisDevice && computer.enabled && computer.online && computer.allowRemote && !computer.pairing
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <Laptop className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="break-words">{computer.name}</span>
            {computer.isOwnedByThisDevice && <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-normal">{ui('This device')}</span>}
            <span className={`rounded px-1.5 py-0.5 text-xs font-normal ${computer.online && computer.enabled ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-accent text-muted-foreground'}`}>{status}</span>
          </div>
          <div className="text-xs text-muted-foreground">{computerOsLabel(computer.os)} · {access}</div>
          {!computer.isOwnedByThisDevice && (
            <div className="text-xs text-muted-foreground">
              {computer.pairing?.status === 'approved' ? ui('Paired with this device')
                : computer.pairing?.status === 'pending' ? ui('Waiting for approval on {{name}}…', { name: computer.name })
                : computer.allowRemote ? ui('Not paired with this device') : ui('Does not allow other devices')}
            </div>
          )}
          {error && <div role="alert" className="text-xs text-destructive">{error}</div>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {canRequest && <Button size="sm" disabled={busy} onClick={() => void run(() => requestComputerPairing(computer.id))}><Link2 />{ui('Pair')}</Button>}
          {computer.pairing && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => revokeComputerPairing(computer.id, computer.pairing!.id))}><Unplug />{computer.pairing.status === 'pending' ? ui('Cancel') : ui('Unpair')}</Button>}
          {!computer.isOwnedByThisDevice && !computer.pairing && !isDesktopRuntime() && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => removeComputer(computer.id))}>{ui('Remove')}</Button>
          )}
        </div>
      </div>
      {computer.isOwnedByThisDevice && pairings.length > 0 && (
        <div className="ml-8 mt-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{ui('Paired devices')}</div>
          {pairings.map((pairing) => {
            const Icon = pairing.appType === 'mobile' ? Smartphone : Monitor
            return (
              <div key={pairing.id} className="flex items-center gap-2 text-xs">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{pairing.deviceLabel}{pairing.requestedIp ? ` · ${pairing.requestedIp}` : ''}{pairing.status === 'pending' ? ` · ${ui('Pending')}` : ''}</span>
                {pairing.status === 'pending' && <Button size="sm" disabled={busy} onClick={() => void run(() => decideComputerPairing(computer.id, pairing.id, true))}>{ui('Approve')}</Button>}
                {pairing.status === 'pending' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => decideComputerPairing(computer.id, pairing.id, false))}>{ui('Deny')}</Button>}
                {pairing.status === 'approved' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => revokeComputerPairing(computer.id, pairing.id))}>{ui('Revoke')}</Button>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Every device sees this: the account's computers, their pairing state, and pending requests. */
export function ComputerSettings() {
  const computersQuery = useAgentComputers()
  const pairingsQuery = useAgentPairings()
  const invalidate = useInvalidateComputers()
  const computers = computersQuery.data?.computers ?? []
  const pairings = pairingsQuery.data?.pairings ?? []
  const featureDisabled = computersQuery.data?.enabled === false
  return (
    <div className="space-y-4">
      {isDesktopRuntime() && !featureDisabled && <ThisComputerCard />}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{ui('Computers')}</h3>
          <Button variant="outline" size="sm" disabled={computersQuery.isFetching} onClick={() => void invalidate()}>
            {computersQuery.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}{ui('Refresh')}
          </Button>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {ui('Computers running the Pulpo desktop app can be chosen as the agent workspace. Other devices need a pairing approved on that computer first.')}
        </p>
        {featureDisabled && <p className="mt-3 text-sm text-muted-foreground">{ui('This Pulpo instance does not allow the agent to use personal computers.')}</p>}
        {computersQuery.isPending && !featureDisabled && <p role="status" className="mt-3 text-sm text-muted-foreground">{ui('Loading computers…')}</p>}
        {computersQuery.error && <div role="alert" className="mt-3 text-sm text-destructive">{computersQuery.error.message}</div>}
        {!computersQuery.isPending && !featureDisabled && !computers.length && (
          <p className="mt-3 text-sm text-muted-foreground">{isDesktopRuntime() ? ui('Turn on “This computer” above to make it available to the agent.') : ui('No computers yet. Open the Pulpo desktop app on a computer and turn on “This computer” in its settings.')}</p>
        )}
        <div className="mt-3 space-y-3">
          {computers.map((computer) => (
            <ComputerRow key={computer.id} computer={computer} pairings={pairings.filter((pairing) => pairing.computerId === computer.id && !pairing.isCurrentDevice)} onChanged={invalidate} />
          ))}
        </div>
      </div>
    </div>
  )
}
