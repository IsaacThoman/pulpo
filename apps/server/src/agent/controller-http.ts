import { Agent, fetch, type RequestInit } from 'undici'
import { getConfig, getWorkspaceInstanceId } from '../config.js'

let dispatcher: Agent | undefined
let dispatcherCertificate: string | undefined

function controllerDispatcher(): Agent | undefined {
  const encoded = getConfig().WORKSPACE_CONTROLLER_CA_CERT_BASE64
  if (!encoded) return undefined
  const certificate = Buffer.from(encoded, 'base64').toString('utf8')
  if (!certificate.includes('-----BEGIN CERTIFICATE-----')) throw new Error('WORKSPACE_CONTROLLER_CA_CERT_BASE64 is not a PEM certificate')
  if (!dispatcher || dispatcherCertificate !== certificate) {
    void dispatcher?.close()
    dispatcher = new Agent({ connect: { ca: certificate } })
    dispatcherCertificate = certificate
  }
  return dispatcher
}

export async function workspaceControllerRequest(path: string, init: RequestInit = {}, authenticate = true): Promise<Response> {
  const config = getConfig()
  if (!config.WORKSPACE_CONTROLLER_URL) throw new Error('Workspace controller is not configured')
  if (authenticate && !config.WORKSPACE_CONTROLLER_TOKEN) throw new Error('Workspace controller authentication is not configured')
  return fetch(`${config.WORKSPACE_CONTROLLER_URL.replace(/\/$/, '')}${path}`, {
    ...init,
    dispatcher: controllerDispatcher(),
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(authenticate ? { 'x-pulpo-instance-id': getWorkspaceInstanceId(config) } : {}),
      ...(authenticate ? { authorization: `Bearer ${config.WORKSPACE_CONTROLLER_TOKEN}` } : {}),
    },
  }) as unknown as Response
}
