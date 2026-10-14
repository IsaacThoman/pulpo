import { request } from 'node:http'

/** The server's answer as the daemon passes it through, or the daemon's own refusal. */
export interface RelayAnswer { ok: boolean; output?: string; data?: unknown; error?: string }

export const DEFAULT_RELAY_SOCKET = '/tmp/pulpo-relay.sock'
export const OUTSIDE_AGENT_BASH = 'pulpo files only works inside bash commands run by the Pulpo agent tool (PULPO_OPERATION_ID is not set). If you used sudo or env -i, run it without them.'

export class RelayUnavailableError extends Error {}

/** One request on the daemon's socket. The daemon holds it until Pulpo answers, so there is no client timeout. */
export function sendRelayRequest(socketPath: string, operationId: string, command: string, args: Record<string, unknown>): Promise<RelayAnswer> {
  const payload = JSON.stringify({ operationId, command, args })
  return new Promise((resolveAnswer, reject) => {
    const outgoing = request({
      socketPath, path: '/v1/requests', method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.once('error', reject)
      response.once('end', () => {
        let answer: unknown
        try { answer = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { answer = undefined }
        if (answer && typeof answer === 'object' && typeof (answer as RelayAnswer).ok === 'boolean') resolveAnswer(answer as RelayAnswer)
        else reject(new Error(`unexpected answer from the workspace daemon (HTTP ${response.statusCode})`))
      })
    })
    outgoing.once('error', (error: NodeJS.ErrnoException) => {
      reject(['ENOENT', 'ECONNREFUSED', 'ENOTSOCK', 'EACCES'].includes(error.code ?? '')
        ? new RelayUnavailableError(`cannot reach the workspace daemon at ${socketPath} (${error.code}). pulpo files only works inside bash commands run by the Pulpo agent tool.`)
        : error)
    })
    outgoing.end(payload)
  })
}
