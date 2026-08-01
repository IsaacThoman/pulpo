import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { randomBytes, randomUUID } from 'node:crypto'
import * as k8s from '@kubernetes/client-node'

const namespace = process.env.PULPO_WORKSPACE_NAMESPACE ?? 'pulpo-workspaces'
const image = process.env.PULPO_WORKSPACE_IMAGE
const authToken = process.env.PULPO_CONTROLLER_TOKEN
const runtimeClassName = process.env.PULPO_RUNTIME_CLASS ?? 'kata'
let warmCapacity = Number(process.env.PULPO_WARM_CAPACITY ?? 1)
const port = Number(process.env.PORT ?? 8786)
if (!image?.includes('@sha256:')) throw new Error('PULPO_WORKSPACE_IMAGE must be an immutable digest reference')
if (!authToken || authToken.length < 32) throw new Error('PULPO_CONTROLLER_TOKEN must contain at least 32 characters')
const tlsCert = process.env.PULPO_CONTROLLER_TLS_CERT
const tlsKey = process.env.PULPO_CONTROLLER_TLS_KEY
if ((!tlsCert || !tlsKey) && process.env.PULPO_ALLOW_INSECURE_HTTP !== 'true') throw new Error('Controller TLS certificate and key are required')

const kc = new k8s.KubeConfig(); kc.loadFromDefault()
const core = kc.makeApiClient(k8s.CoreV1Api)
type Lease = { id: string; podName: string; podIp: string; daemonToken: string; createdAt: number; lastUsedAt: number; idleMs: number; hardMs: number }
type WorkspaceSpec = { imageDigest: string; cpu: string; memory: string; ephemeralStorage: string }
let desiredSpec: WorkspaceSpec = { imageDigest: image, cpu: '2', memory: '2Gi', ephemeralStorage: '20Gi' }
const leases = new Map<string, Lease>()

function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
async function body(request: IncomingMessage): Promise<Buffer> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks) }
function podName(): string { return `pulpo-workspace-${randomUUID().slice(0, 8)}` }

function podMatches(pod: k8s.V1Pod, spec: WorkspaceSpec): boolean {
  const container = pod.spec?.containers[0]
  const requests = container?.resources?.requests
  return container?.image === spec.imageDigest && requests?.cpu === spec.cpu && requests?.memory === spec.memory && requests?.['ephemeral-storage'] === spec.ephemeralStorage
}

async function createWarmPod(spec = desiredSpec): Promise<void> {
  const name = podName(); const daemonToken = randomBytes(32).toString('hex')
  await core.createNamespacedPod({ namespace, body: {
    metadata: { name, labels: { 'app.kubernetes.io/name': 'pulpo-workspace', 'pulpo.dev/state': 'warm' }, annotations: { 'pulpo.dev/daemon-token': daemonToken } },
    spec: {
      runtimeClassName, automountServiceAccountToken: false, restartPolicy: 'Never', enableServiceLinks: false,
      securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
      containers: [{ name: 'workspace', image: spec.imageDigest, imagePullPolicy: 'IfNotPresent', env: [{ name: 'PULPO_WORKSPACE_TOKEN', value: daemonToken }], ports: [{ name: 'daemon', containerPort: 8787 }], readinessProbe: { httpGet: { path: '/healthz', port: 8787 }, periodSeconds: 2 }, resources: { requests: { cpu: spec.cpu, memory: spec.memory, 'ephemeral-storage': spec.ephemeralStorage }, limits: { cpu: spec.cpu, memory: spec.memory, 'ephemeral-storage': spec.ephemeralStorage } }, securityContext: { allowPrivilegeEscalation: true } }],
    },
  } })
}

async function reconcile(): Promise<void> {
  const pods = (await core.listNamespacedPod({ namespace, labelSelector: 'app.kubernetes.io/name=pulpo-workspace' })).items
  for (const pod of pods) {
    const leaseId = pod.metadata?.labels?.['pulpo.dev/lease-id']; const annotations = pod.metadata?.annotations
    if (!leaseId || leases.has(leaseId) || !pod.metadata?.name || !pod.status?.podIP) continue
    leases.set(leaseId, { id: leaseId, podName: pod.metadata.name, podIp: pod.status.podIP, daemonToken: annotations?.['pulpo.dev/daemon-token'] ?? '', createdAt: Number(annotations?.['pulpo.dev/created-at'] ?? Date.now()), lastUsedAt: Number(annotations?.['pulpo.dev/last-used-at'] ?? Date.now()), idleMs: Number(annotations?.['pulpo.dev/idle-ms'] ?? 3_600_000), hardMs: Number(annotations?.['pulpo.dev/hard-ms'] ?? 28_800_000) })
  }
  const now = Date.now()
  for (const lease of leases.values()) if (now - lease.lastUsedAt > lease.idleMs || now - lease.createdAt > lease.hardMs) {
    await core.deleteNamespacedPod({ namespace, name: lease.podName }).catch(() => undefined); leases.delete(lease.id)
  }
  const allWarm = pods.filter((pod) => pod.metadata?.labels?.['pulpo.dev/state'] === 'warm')
  const incompatible = allWarm.filter((pod) => !podMatches(pod, desiredSpec))
  await Promise.all(incompatible.flatMap((pod) => pod.metadata?.name ? [core.deleteNamespacedPod({ namespace, name: pod.metadata.name }).catch(() => undefined)] : []))
  const warm = allWarm.filter((pod) => podMatches(pod, desiredSpec))
  for (let count = warm.length; count < warmCapacity; count += 1) await createWarmPod()
}

async function claim(input: { imageDigest?: string; resources?: Partial<Omit<WorkspaceSpec, 'imageDigest'>>; warmCapacity?: number; idleTimeoutSeconds?: number; hardTimeoutSeconds?: number; maxActiveWorkspaces?: number }): Promise<Lease> {
  if (!input.imageDigest?.includes('@sha256:')) throw new Error('An immutable workspace image digest is required')
  desiredSpec = { imageDigest: input.imageDigest, cpu: input.resources?.cpu || desiredSpec.cpu, memory: input.resources?.memory || desiredSpec.memory, ephemeralStorage: input.resources?.ephemeralStorage || desiredSpec.ephemeralStorage }
  if (Number.isInteger(input.warmCapacity)) warmCapacity = Math.max(0, Math.min(100, input.warmCapacity!))
  await reconcile()
  if (leases.size >= Math.max(1, input.maxActiveWorkspaces ?? 3)) throw new Error('Maximum active workspace capacity reached')
  let pod: k8s.V1Pod | undefined
  const deadline = Date.now() + 90_000
  while (!pod && Date.now() < deadline) {
    const pods = (await core.listNamespacedPod({ namespace, labelSelector: 'app.kubernetes.io/name=pulpo-workspace,pulpo.dev/state=warm' })).items
    pod = pods.find((candidate) => podMatches(candidate, desiredSpec) && candidate.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'))
    if (!pod) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!pod?.metadata?.name || !pod.status?.podIP) throw new Error('No warm workspace is ready')
  const id = randomUUID()
  const createdAt = Date.now(); const idleMs = (input.idleTimeoutSeconds ?? 1800) * 1000; const hardMs = (input.hardTimeoutSeconds ?? 14400) * 1000
  await core.patchNamespacedPod({ namespace, name: pod.metadata.name, body: { metadata: { labels: { 'pulpo.dev/state': 'claimed', 'pulpo.dev/lease-id': id }, annotations: { 'pulpo.dev/created-at': String(createdAt), 'pulpo.dev/last-used-at': String(createdAt), 'pulpo.dev/idle-ms': String(idleMs), 'pulpo.dev/hard-ms': String(hardMs) } } } }, k8s.setHeaderOptions('content-type', k8s.PatchStrategy.MergePatch))
  const lease: Lease = { id, podName: pod.metadata.name, podIp: pod.status.podIP, daemonToken: pod.metadata.annotations?.['pulpo.dev/daemon-token'] ?? '', createdAt, lastUsedAt: createdAt, idleMs, hardMs }
  leases.set(id, lease); void reconcile(); return lease
}

async function proxy(lease: Lease, request: IncomingMessage, pathname: string, search = ''): Promise<Response> {
  lease.lastUsedAt = Date.now()
  void core.patchNamespacedPod({ namespace, name: lease.podName, body: { metadata: { annotations: { 'pulpo.dev/last-used-at': String(lease.lastUsedAt) } } } }, k8s.setHeaderOptions('content-type', k8s.PatchStrategy.MergePatch)).catch(() => undefined)
  const payload = ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : new Uint8Array(await body(request))
  return fetch(`http://${lease.podIp}:8787${pathname}${search}`, { method: request.method, headers: { authorization: `Bearer ${lease.daemonToken}`, 'content-type': request.headers['content-type'] ?? 'application/json' }, body: payload })
}

const handler = async (request: IncomingMessage, response: ServerResponse) => {
  try {
    if (request.url === '/healthz') { await reconcile(); return json(response, 200, { status: 'ok', warmCapacity, active: leases.size }) }
    if (request.headers.authorization !== `Bearer ${authToken}`) return json(response, 401, { error: 'unauthorized' })
    const url = new URL(request.url ?? '/', 'http://controller')
    if (request.method === 'POST' && url.pathname === '/v1/leases') return json(response, 201, await claim(JSON.parse((await body(request)).toString('utf8') || '{}')))
    const match = url.pathname.match(/^\/v1\/leases\/([^/]+)(\/.*)?$/); const lease = match ? leases.get(match[1]!) : undefined
    if (!lease) return json(response, 404, { error: 'lease_not_found' })
    if (request.method === 'DELETE' && !match?.[2]) { await core.deleteNamespacedPod({ namespace, name: lease.podName }); leases.delete(lease.id); return json(response, 200, { status: 'released' }) }
    const upstream = await proxy(lease, request, match?.[2] || '/', url.search)
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }); response.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) { json(response, 503, { error: error instanceof Error ? error.message : String(error) }) }
}
const server = tlsCert && tlsKey ? createHttpsServer({ cert: tlsCert, key: tlsKey }, handler) : createHttpServer(handler)

setInterval(() => void reconcile().catch((error) => console.error(error)), 15_000).unref()
server.listen(port, '0.0.0.0', () => void reconcile())
