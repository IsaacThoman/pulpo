import { describe, expect, it } from 'vitest'
import type * as k8s from '@kubernetes/client-node'
import { parseEgressProxyUrl, podEgressProxy, workspaceEgressSettings } from './egress.js'

describe('workspace egress proxy', () => {
  it('is optional', () => {
    expect(parseEgressProxyUrl(undefined)).toBeUndefined()
    expect(parseEgressProxyUrl('')).toBeUndefined()
    expect(workspaceEgressSettings(undefined)).toEqual({ env: [], podSpec: {} })
  })

  it('normalizes an IPv4 proxy URL', () => {
    expect(parseEgressProxyUrl('http://10.43.47.50:4750/')).toBe('http://10.43.47.50:4750')
  })

  it('rejects proxy URLs that would need DNS or carry credentials', () => {
    for (const value of [
      'http://pulpo-workspace-egress-proxy:4750',
      'https://10.43.47.50:4750',
      'http://10.43.47.50',
      'http://user:pass@10.43.47.50:4750',
      'http://10.43.47.50:4750/path',
      'not a url',
    ]) expect(() => parseEgressProxyUrl(value), value).toThrow()
  })

  it('routes HTTP(S) through the proxy and removes DNS', () => {
    const { env, podSpec } = workspaceEgressSettings('http://10.43.47.50:4750')
    const values = Object.fromEntries(env.map((variable) => [variable.name, variable.value]))
    expect(values).toMatchObject({
      HTTP_PROXY: 'http://10.43.47.50:4750',
      HTTPS_PROXY: 'http://10.43.47.50:4750',
      http_proxy: 'http://10.43.47.50:4750',
      https_proxy: 'http://10.43.47.50:4750',
      NODE_USE_ENV_PROXY: '1',
    })
    expect(podSpec).toEqual({ dnsPolicy: 'None', dnsConfig: { nameservers: ['127.0.0.1'] } })
  })

  it('reads the proxy a pod was created with', () => {
    const pod = (env?: k8s.V1EnvVar[]): k8s.V1Pod => ({ spec: { containers: [{ name: 'workspace', env }] } })
    expect(podEgressProxy(pod())).toBeUndefined()
    expect(podEgressProxy(pod(workspaceEgressSettings('http://10.43.47.50:4750').env))).toBe('http://10.43.47.50:4750')
  })
})
