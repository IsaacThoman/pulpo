import { isIPv4 } from 'node:net'
import type * as k8s from '@kubernetes/client-node'

export const PROXY_ENV_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'] as const

/** Workspaces have no DNS, so the proxy must be addressed by IP (a fixed Service clusterIP). */
export function parseEgressProxyUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  let url: URL
  try { url = new URL(value) } catch { throw new Error('PULPO_WORKSPACE_EGRESS_PROXY_URL must be a URL') }
  if (url.protocol !== 'http:' || !isIPv4(url.hostname) || !url.port || url.pathname !== '/' || url.username || url.search) {
    throw new Error('PULPO_WORKSPACE_EGRESS_PROXY_URL must look like http://<IPv4>:<port>')
  }
  return `http://${url.hostname}:${url.port}`
}

/** Pod settings that force all workspace HTTP(S) through the proxy and remove DNS. */
export function workspaceEgressSettings(proxyUrl: string | undefined): {
  env: k8s.V1EnvVar[]
  podSpec: Pick<k8s.V1PodSpec, 'dnsPolicy' | 'dnsConfig'>
} {
  if (!proxyUrl) return { env: [], podSpec: {} }
  return {
    env: [
      ...PROXY_ENV_NAMES.map((name) => ({ name, value: proxyUrl })),
      { name: 'NO_PROXY', value: 'localhost,127.0.0.1,::1' },
      { name: 'no_proxy', value: 'localhost,127.0.0.1,::1' },
      // Node's fetch ignores proxy variables unless this is set.
      { name: 'NODE_USE_ENV_PROXY', value: '1' },
    ],
    // Nothing listens on the guest's loopback port 53, so lookups fail fast.
    podSpec: { dnsPolicy: 'None', dnsConfig: { nameservers: ['127.0.0.1'] } },
  }
}

/** The proxy a pod was created with, so warm pods are replaced when it changes. */
export function podEgressProxy(pod: k8s.V1Pod): string | undefined {
  return pod.spec?.containers[0]?.env?.find((variable) => variable.name === 'HTTPS_PROXY')?.value
}
