import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as k8s from '@kubernetes/client-node'
import { BOUNDED_RUNTIME, storageSettings, workspacePodSlots } from './storage.js'
import { CapacityReservationError, CapacityTracker, WorkspaceCapacityError } from './capacity.js'
import { isStaleStartingPod, isUnleasedOrphanPod, podMatchesSpec, WORKSPACE_SPEC_HASH_ANNOTATION, workspaceSpecHash, type WorkspaceSpec } from './workspace-spec.js'
import { effectiveWarmTargets, instanceIdHash, normalizeInstanceId, WORKSPACE_INSTANCE_ANNOTATION, WORKSPACE_INSTANCE_HASH_LABEL, WORKSPACE_INSTANCE_HEADER, type WarmRequest } from './tenancy.js'

const namespace = process.env.PULPO_WORKSPACE_NAMESPACE ?? 'pulpo-workspaces'
const image = process.env.PULPO_WORKSPACE_IMAGE
const authToken = process.env.PULPO_CONTROLLER_TOKEN
const runtimeClassName = process.env.PULPO_RUNTIME_CLASS ?? 'kata'

function environmentInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

const defaultWarmCapacity = environmentInteger('PULPO_WARM_CAPACITY', 1, 0, 100)
const maxWorkspacePods = environmentInteger('PULPO_MAX_WORKSPACE_PODS', runtimeClassName === BOUNDED_RUNTIME ? 6 : 100, 1, 10_000)
const maxActiveWorkspacesTotal = environmentInteger('PULPO_MAX_ACTIVE_WORKSPACES_TOTAL', 100, 1, 10_000)
const port = environmentInteger('PORT', 8786, 1, 65_535)
if (!image?.includes('@sha256:')) throw new Error('PULPO_WORKSPACE_IMAGE must be an immutable digest reference')
if (!authToken || authToken.length < 32) throw new Error('PULPO_CONTROLLER_TOKEN must contain at least 32 characters')
const tlsCert = process.env.PULPO_CONTROLLER_TLS_CERT
const tlsKey = process.env.PULPO_CONTROLLER_TLS_KEY
if ((!tlsCert || !tlsKey) && process.env.PULPO_ALLOW_INSECURE_HTTP !== 'true') throw new Error('Controller TLS certificate and key are required')

const kc = new k8s.KubeConfig(); kc.loadFromDefault()
const core = kc.makeApiClient(k8s.CoreV1Api)
type Lease = {
  id: string
  instanceId: string
  podName: string
  podIp: string
  daemonToken: string
  specHash: string
  createdAt: number
  lastUsedAt: number
  idleMs: number
  hardMs: number
}
type ClaimInput = {
  chatId?: string
  imageDigest?: string
  capacityReservationId?: string
  resources?: Partial<Omit<WorkspaceSpec, 'imageDigest'>>
  warmCapacity?: number
  idleTimeoutSeconds?: number
  hardTimeoutSeconds?: number
  maxActiveWorkspaces?: number
}

const defaultSpec: WorkspaceSpec = { imageDigest: image, cpu: '2', memory: '2048Mi', ephemeralStorage: '20Gi' }
const controllerWarmRequest: WarmRequest = { spec: defaultSpec, capacity: defaultWarmCapacity }
const warmRequests = new Map<string, WarmRequest>()
const leases = new Map<string, Lease>()
const activeOperations = new Map<string, Set<string>>()
const capacityTracker = new CapacityTracker({ maxActiveTotal: maxActiveWorkspacesTotal })
let reconcileInFlight: Promise<void> | undefined
let warmClaimTail: Promise<void> = Promise.resolve()
let podCreationTail: Promise<void> = Promise.resolve()
let useControllerWarmRequest = defaultWarmCapacity > 0

function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
async function body(request: IncomingMessage): Promise<Buffer> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks) }
function podName(): string { return `pulpo-workspace-${randomUUID().slice(0, 8)}` }
function podInstanceId(pod: k8s.V1Pod): string { return pod.metadata?.annotations?.[WORKSPACE_INSTANCE_ANNOTATION] ?? 'default' }
function activeForInstance(instanceId: string): number { return [...leases.values()].filter((lease) => lease.instanceId === instanceId).length }
function currentWarmTargets() { return effectiveWarmTargets([...(useControllerWarmRequest ? [controllerWarmRequest] : []), ...warmRequests.values()]) }
function desiredSpec(instanceId: string): WorkspaceSpec { return warmRequests.get(instanceId)?.spec ?? defaultSpec }
function configuredWarmCapacity(instanceId: string): number { return currentWarmTargets().get(workspaceSpecHash(desiredSpec(instanceId)))?.capacity ?? 0 }

async function withWarmClaimLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = warmClaimTail
  let release!: () => void
  warmClaimTail = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await operation() } finally { release() }
}

async function createWorkspacePod(state: 'warm' | 'starting', spec: WorkspaceSpec, chatId?: string, instanceId?: string): Promise<{ name: string; daemonToken: string }> {
  const storage = storageSettings(runtimeClassName, spec)
  const previous = podCreationTail
  let release!: () => void
  podCreationTail = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    const pods = (await core.listNamespacedPod({ namespace, labelSelector: 'app.kubernetes.io/name=pulpo-workspace' })).items
    if (workspacePodSlots(pods) >= maxWorkspacePods) throw new WorkspaceCapacityError('controller')
    const name = podName()
    const daemonToken = randomBytes(32).toString('hex')
    await core.createNamespacedPod({ namespace, body: {
      metadata: {
        name,
        labels: {
          'app.kubernetes.io/name': 'pulpo-workspace',
          'pulpo.dev/state': state,
          ...(instanceId ? { [WORKSPACE_INSTANCE_HASH_LABEL]: instanceIdHash(instanceId) } : {}),
        },
        annotations: {
          'pulpo.dev/daemon-token': daemonToken,
          [WORKSPACE_SPEC_HASH_ANNOTATION]: workspaceSpecHash(spec),
          ...(instanceId ? { [WORKSPACE_INSTANCE_ANNOTATION]: instanceId } : {}),
          ...(chatId ? { 'pulpo.dev/chat-id': chatId } : {}),
        },
      },
      spec: {
        runtimeClassName, automountServiceAccountToken: false, restartPolicy: 'Never', enableServiceLinks: false,
        securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
        containers: [{ name: 'workspace', ...(storage.command ? { command: storage.command } : {}), image: spec.imageDigest, imagePullPolicy: 'IfNotPresent', env: [{ name: 'PULPO_WORKSPACE_TOKEN', value: daemonToken }], ports: [{ name: 'daemon', containerPort: 8787 }], readinessProbe: { httpGet: { path: '/healthz', port: 8787 }, periodSeconds: 2 }, resources: { requests: { cpu: spec.cpu, memory: spec.memory, 'ephemeral-storage': spec.ephemeralStorage }, limits: { cpu: spec.cpu, memory: spec.memory, 'ephemeral-storage': storage.limit } }, securityContext: { allowPrivilegeEscalation: true } }],
      },
    } })
    return { name, daemonToken }
  } finally { release() }
}

function isPodReady(pod: k8s.V1Pod | undefined): pod is k8s.V1Pod & { metadata: { name: string }; status: { podIP: string } } {
  return Boolean(
    pod?.metadata?.name
    && pod.status?.podIP
    && pod.status.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'),
  )
}

async function findReadyWarmPod(spec: WorkspaceSpec): Promise<k8s.V1Pod | undefined> {
  const pods = (await core.listNamespacedPod({ namespace, labelSelector: 'app.kubernetes.io/name=pulpo-workspace,pulpo.dev/state=warm' })).items
  return pods.find((candidate) => podMatchesSpec(candidate, spec, runtimeClassName) && isPodReady(candidate))
}

async function waitForPodReady(name: string, deadline: number): Promise<k8s.V1Pod> {
  while (Date.now() < deadline) {
    const pod = await core.readNamespacedPod({ namespace, name })
    if (isPodReady(pod)) return pod
    if (pod.status?.phase === 'Failed' || pod.status?.phase === 'Succeeded') {
      throw new Error(`Workspace pod ${name} failed to start (${pod.status.phase})`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Workspace pod ${name} did not become ready in time`)
}

async function reconcileOnce(): Promise<void> {
  capacityTracker.pruneExpired()
  const pods = (await core.listNamespacedPod({ namespace, labelSelector: 'app.kubernetes.io/name=pulpo-workspace' })).items
  const podNames = new Set(pods.flatMap((pod) => pod.metadata?.name ? [pod.metadata.name] : []))
  for (const [leaseId, lease] of leases) if (!podNames.has(lease.podName)) { leases.delete(leaseId); activeOperations.delete(leaseId) }
  for (const pod of pods) {
    const leaseId = pod.metadata?.labels?.['pulpo.dev/lease-id']; const annotations = pod.metadata?.annotations
    if (!leaseId || leases.has(leaseId) || !pod.metadata?.name || !pod.status?.podIP) continue
    leases.set(leaseId, {
      id: leaseId,
      instanceId: podInstanceId(pod),
      podName: pod.metadata.name,
      podIp: pod.status.podIP,
      daemonToken: annotations?.['pulpo.dev/daemon-token'] ?? '',
      specHash: annotations?.[WORKSPACE_SPEC_HASH_ANNOTATION] ?? '',
      createdAt: Number(annotations?.['pulpo.dev/created-at'] ?? Date.now()),
      lastUsedAt: Number(annotations?.['pulpo.dev/last-used-at'] ?? Date.now()),
      idleMs: Number(annotations?.['pulpo.dev/idle-ms'] ?? 3_600_000),
      hardMs: Number(annotations?.['pulpo.dev/hard-ms'] ?? 28_800_000),
    })
  }
  const now = Date.now()
  for (const lease of leases.values()) if (now - lease.lastUsedAt > lease.idleMs || now - lease.createdAt > lease.hardMs) {
    await core.deleteNamespacedPod({ namespace, name: lease.podName }).catch(() => undefined); leases.delete(lease.id); activeOperations.delete(lease.id)
  }
  const staleStarting = pods.filter((pod) => isStaleStartingPod(pod, now))
  await Promise.all(staleStarting.flatMap((pod) => pod.metadata?.name ? [core.deleteNamespacedPod({ namespace, name: pod.metadata.name }).catch(() => undefined)] : []))

  const targets = currentWarmTargets()
  const allWarm = pods.filter((pod) => pod.metadata?.labels?.['pulpo.dev/state'] === 'warm')
  const retained = new Set<string>()
  for (const target of targets.values()) {
    const compatible = allWarm.filter((pod) => podMatchesSpec(pod, target.spec, runtimeClassName))
    const keep = compatible.slice(0, target.capacity)
    for (const pod of keep) if (pod.metadata?.name) retained.add(pod.metadata.name)
    for (let count = keep.length; count < target.capacity; count += 1) {
      try { await createWorkspacePod('warm', target.spec) } catch (error) {
        if (error instanceof WorkspaceCapacityError) break
        throw error
      }
    }
  }
  const excess = allWarm.filter((pod) => pod.metadata?.name && !retained.has(pod.metadata.name))
  await Promise.all(excess.flatMap((pod) => pod.metadata?.name ? [core.deleteNamespacedPod({ namespace, name: pod.metadata.name }).catch(() => undefined)] : []))
}

async function reconcile(): Promise<void> {
  if (reconcileInFlight) return reconcileInFlight
  const run = reconcileOnce()
  reconcileInFlight = run
  try { await run } finally { if (reconcileInFlight === run) reconcileInFlight = undefined }
}

async function claimPod(pod: k8s.V1Pod, instanceId: string, input: ClaimInput, spec: WorkspaceSpec): Promise<Lease> {
  if (!isPodReady(pod)) throw new Error('Workspace failed to become ready')
  const id = randomUUID()
  const createdAt = Date.now(); const idleMs = (input.idleTimeoutSeconds ?? 1800) * 1000; const hardMs = (input.hardTimeoutSeconds ?? 14400) * 1000
  await core.patchNamespacedPod({ namespace, name: pod.metadata.name, body: { metadata: {
    labels: { 'pulpo.dev/state': 'claimed', 'pulpo.dev/lease-id': id, [WORKSPACE_INSTANCE_HASH_LABEL]: instanceIdHash(instanceId) },
    annotations: {
      [WORKSPACE_INSTANCE_ANNOTATION]: instanceId,
      [WORKSPACE_SPEC_HASH_ANNOTATION]: workspaceSpecHash(spec),
      'pulpo.dev/created-at': String(createdAt),
      'pulpo.dev/last-used-at': String(createdAt),
      'pulpo.dev/idle-ms': String(idleMs),
      'pulpo.dev/hard-ms': String(hardMs),
      ...(input.chatId ? { 'pulpo.dev/chat-id': input.chatId } : {}),
    },
  } } }, k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch))
  const lease: Lease = {
    id,
    instanceId,
    podName: pod.metadata.name,
    podIp: pod.status.podIP,
    daemonToken: pod.metadata.annotations?.['pulpo.dev/daemon-token'] ?? '',
    specHash: workspaceSpecHash(spec),
    createdAt,
    lastUsedAt: createdAt,
    idleMs,
    hardMs,
  }
  leases.set(id, lease)
  return lease
}

// The controller deployment is intentionally a singleton. This lock prevents two
// concurrent requests from observing and claiming the same ready warm pod.
async function tryClaimWarmPod(instanceId: string, input: ClaimInput, spec: WorkspaceSpec): Promise<Lease | undefined> {
  return withWarmClaimLock(async () => {
    const pod = await findReadyWarmPod(spec)
    return pod ? claimPod(pod, instanceId, input, spec) : undefined
  })
}

async function claim(instanceId: string, input: ClaimInput): Promise<Lease> {
  if (!input.imageDigest?.includes('@sha256:')) throw new Error('An immutable workspace image digest is required')
  const spec: WorkspaceSpec = {
    imageDigest: input.imageDigest,
    cpu: input.resources?.cpu || defaultSpec.cpu,
    memory: input.resources?.memory || defaultSpec.memory,
    ephemeralStorage: input.resources?.ephemeralStorage || defaultSpec.ephemeralStorage,
  }
  storageSettings(runtimeClassName, spec)
  const requestedWarmCapacity = Number.isInteger(input.warmCapacity) ? Math.max(0, Math.min(100, input.warmCapacity!)) : 0
  if (requestedWarmCapacity > 0) useControllerWarmRequest = false
  warmRequests.set(instanceId, { spec, capacity: requestedWarmCapacity })
  let capacityReservationId = input.capacityReservationId
  if (capacityReservationId) capacityTracker.consume(capacityReservationId, instanceId)
  try {
    await reconcile()
    if (!capacityReservationId) {
      const reservation = capacityTracker.reserve(instanceId, input.maxActiveWorkspaces ?? 3, activeForInstance(instanceId), leases.size)
      capacityTracker.consume(reservation.id, instanceId)
      capacityReservationId = reservation.id
    }
    const deadline = Date.now() + 180_000
    let lease = await tryClaimWarmPod(instanceId, input, spec)
    if (!lease && requestedWarmCapacity > 0) {
      const warmDeadline = Math.min(deadline, Date.now() + 15_000)
      while (!lease && Date.now() < warmDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        lease = await tryClaimWarmPod(instanceId, input, spec)
      }
    }
    if (!lease) {
      const created = await createWorkspacePod('starting', spec, input.chatId, instanceId)
      lease = await claimPod(await waitForPodReady(created.name, deadline), instanceId, input, spec)
    }
    void reconcile()
    return lease
  } finally {
    if (capacityReservationId) capacityTracker.complete(capacityReservationId)
  }
}

async function proxy(lease: Lease, request: IncomingMessage, pathname: string, search = ''): Promise<Response> {
  lease.lastUsedAt = Date.now()
  void core.patchNamespacedPod({ namespace, name: lease.podName, body: { metadata: { annotations: { 'pulpo.dev/last-used-at': String(lease.lastUsedAt) } } } }, k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch)).catch(() => undefined)
  const hasBody = !['GET', 'HEAD'].includes(request.method ?? 'GET')
  const init = {
    method: request.method,
    headers: {
      authorization: `Bearer ${lease.daemonToken}`,
      'content-type': request.headers['content-type'] ?? 'application/json',
      ...(request.headers['content-length'] ? { 'content-length': request.headers['content-length'] } : {}),
    },
    ...(hasBody ? { body: request, duplex: 'half' as const } : {}),
  }
  const upstream = await fetch(`http://${lease.podIp}:8787${pathname}${search}`, init as unknown as RequestInit)
  if (/^\/v1\/operations(?:\/[^/]+(?:\/cancel)?)?$/.test(pathname) && upstream.ok) {
    const operation = await upstream.clone().json().catch(() => null) as { id?: string; status?: string } | null
    if (operation?.id) {
      const running = activeOperations.get(lease.id) ?? new Set<string>()
      if (operation.status === 'running') running.add(operation.id)
      else running.delete(operation.id)
      if (running.size) activeOperations.set(lease.id, running)
      else activeOperations.delete(lease.id)
    }
  }
  return upstream
}

async function workspaceInventory(instanceId: string) {
  const pods = (await core.listNamespacedPod({ namespace, labelSelector: 'app.kubernetes.io/name=pulpo-workspace' })).items
  const spec = desiredSpec(instanceId)
  return pods.filter((pod) => {
    const state = pod.metadata?.labels?.['pulpo.dev/state']
    return state === 'warm' ? podMatchesSpec(pod, spec) : podInstanceId(pod) === instanceId
  }).map((pod) => {
    const labels = pod.metadata?.labels ?? {}
    const annotations = pod.metadata?.annotations ?? {}
    const leaseId = labels['pulpo.dev/lease-id']
    const lease = leaseId ? leases.get(leaseId) : undefined
    const activeOperationCount = leaseId && lease && Date.now() - lease.lastUsedAt < 2_000 ? activeOperations.get(leaseId)?.size ?? 0 : 0
    const ready = isPodReady(pod)
    const podState = labels['pulpo.dev/state']
    const lifecycleState = pod.metadata?.deletionTimestamp
      ? 'shutting_down'
      : podState === 'warm'
        ? ready ? 'warm' : 'warming'
        : podState === 'starting'
          ? 'starting'
          : podState === 'claimed'
            ? activeOperationCount ? 'active' : 'idle'
            : 'unknown'
    const podCreatedAt = new Date(pod.metadata?.creationTimestamp ?? Date.now()).getTime()
    const leaseCreatedAt = lease?.createdAt ?? Number(annotations['pulpo.dev/created-at'] ?? podCreatedAt)
    const lastUsedAt = lease?.lastUsedAt ?? Number(annotations['pulpo.dev/last-used-at'] ?? 0)
    const idleMs = lease?.idleMs ?? Number(annotations['pulpo.dev/idle-ms'] ?? 0)
    const hardMs = lease?.hardMs ?? Number(annotations['pulpo.dev/hard-ms'] ?? 0)
    const container = pod.status?.containerStatuses?.[0]
    return {
      id: pod.metadata?.uid ?? pod.metadata?.name,
      name: pod.metadata?.name,
      leaseId: leaseId ?? null,
      instanceId: annotations[WORKSPACE_INSTANCE_ANNOTATION] ?? null,
      chatId: annotations['pulpo.dev/chat-id'] ?? null,
      lifecycleState,
      phase: pod.status?.phase ?? 'Unknown',
      ready,
      activeOperations: activeOperationCount,
      createdAt: new Date(podCreatedAt).toISOString(),
      lastUsedAt: lastUsedAt ? new Date(lastUsedAt).toISOString() : null,
      idleExpiresAt: lastUsedAt && idleMs ? new Date(lastUsedAt + idleMs).toISOString() : null,
      hardExpiresAt: leaseCreatedAt && hardMs ? new Date(leaseCreatedAt + hardMs).toISOString() : null,
      deletionStartedAt: pod.metadata?.deletionTimestamp ? new Date(pod.metadata.deletionTimestamp).toISOString() : null,
      imageDigest: pod.spec?.containers[0]?.image ?? null,
      restartCount: container?.restartCount ?? 0,
    }
  })
}

const handler = async (request: IncomingMessage, response: ServerResponse) => {
  try {
    if (request.url === '/healthz') { await reconcile(); return json(response, 200, { status: 'ok', warmCapacity: [...currentWarmTargets().values()].reduce((total, target) => total + target.capacity, 0), active: leases.size }) }
    if (request.headers.authorization !== `Bearer ${authToken}`) return json(response, 401, { error: 'unauthorized' })
    let instanceId: string
    try { instanceId = normalizeInstanceId(request.headers[WORKSPACE_INSTANCE_HEADER] ?? 'default') } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    const url = new URL(request.url ?? '/', 'http://controller')
    if (request.method === 'POST' && url.pathname === '/v1/capacity-reservations') {
      const input = JSON.parse((await body(request)).toString('utf8') || '{}') as { maxActiveWorkspaces?: number }
      await reconcile()
      const reservation = capacityTracker.reserve(
        instanceId,
        Number.isInteger(input.maxActiveWorkspaces) ? input.maxActiveWorkspaces! : 3,
        activeForInstance(instanceId),
        leases.size,
      )
      return json(response, 201, { id: reservation.id, expiresAt: new Date(reservation.expiresAt).toISOString() })
    }
    const capacityReservationMatch = url.pathname.match(/^\/v1\/capacity-reservations\/([^/]+)$/)
    if (request.method === 'DELETE' && capacityReservationMatch) {
      const released = capacityTracker.cancel(decodeURIComponent(capacityReservationMatch[1]!), instanceId)
      return json(response, 200, { status: released ? 'released' : 'not_released' })
    }
    if (request.method === 'POST' && url.pathname === '/v1/leases') return json(response, 201, await claim(instanceId, JSON.parse((await body(request)).toString('utf8') || '{}')))
    if (request.method === 'GET' && url.pathname === '/v1/leases') {
      await reconcile()
      return json(response, 200, { leases: [...leases.values()].filter((lease) => lease.instanceId === instanceId).map((lease) => ({ id: lease.id, createdAt: lease.createdAt, lastUsedAt: lease.lastUsedAt })) })
    }
    if (request.method === 'GET' && url.pathname === '/v1/workspaces') return json(response, 200, { warmCapacity: configuredWarmCapacity(instanceId), active: activeForInstance(instanceId), globalActive: leases.size, workspaces: await workspaceInventory(instanceId) })
    const workspaceMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)$/)
    if (request.method === 'DELETE' && workspaceMatch) {
      const name = decodeURIComponent(workspaceMatch[1]!)
      let pod: k8s.V1Pod
      try {
        pod = await core.readNamespacedPod({ namespace, name })
      } catch (error) {
        const statusCode = (error as { statusCode?: number; code?: number }).statusCode ?? (error as { code?: number }).code
        if (statusCode === 404) return json(response, 404, { error: 'workspace_not_found' })
        throw error
      }
      if (podInstanceId(pod) !== instanceId) return json(response, 404, { error: 'workspace_not_found' })
      if (!isUnleasedOrphanPod(pod)) return json(response, 409, { error: 'workspace_is_not_an_unleased_orphan' })
      await core.deleteNamespacedPod({ namespace, name })
      return json(response, 200, { status: 'deleted' })
    }
    const match = url.pathname.match(/^\/v1\/leases\/([^/]+)(\/.*)?$/); const lease = match ? leases.get(match[1]!) : undefined
    if (!lease || lease.instanceId !== instanceId) return json(response, 404, { error: 'lease_not_found' })
    if (request.method === 'DELETE' && !match?.[2]) { await core.deleteNamespacedPod({ namespace, name: lease.podName }); leases.delete(lease.id); activeOperations.delete(lease.id); return json(response, 200, { status: 'released' }) }
    const upstream = await proxy(lease, request, match?.[2] || '/', url.search)
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      ...(upstream.headers.get('content-length') ? { 'content-length': upstream.headers.get('content-length')! } : {}),
    })
    if (!upstream.body) return response.end()
    await pipeline(Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream), response)
  } catch (error) {
    if (response.headersSent) response.destroy(error instanceof Error ? error : new Error(String(error)))
    else if (error instanceof WorkspaceCapacityError) json(response, 503, { error: error.message, code: error.code, scope: error.scope })
    else if (error instanceof CapacityReservationError) json(response, 409, { error: error.message, code: error.code })
    else json(response, 503, { error: error instanceof Error ? error.message : String(error) })
  }
}
const server = tlsCert && tlsKey ? createHttpsServer({ cert: tlsCert, key: tlsKey }, handler) : createHttpServer(handler)

setInterval(() => void reconcile().catch((error) => console.error(error)), 15_000).unref()
server.listen(port, '0.0.0.0', () => void reconcile())
