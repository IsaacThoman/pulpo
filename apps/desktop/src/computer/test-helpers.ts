import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** A stand-in for the instance's transfer route: stores PUT bodies, serves GET bodies, records what was sent. */
export interface TransferServer {
  origin: string
  uploads: Map<string, Buffer>
  downloads: Map<string, Buffer>
  requests: Array<{ method: string; url: string; headers: IncomingHttpHeaders }>
  close: () => Promise<void>
}

export async function startTransferServer(): Promise<TransferServer> {
  const uploads = new Map<string, Buffer>()
  const downloads = new Map<string, Buffer>()
  const requests: TransferServer['requests'] = []
  const server: Server = createServer(async (request, response) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers })
    if (request.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      uploads.set(request.url ?? '', Buffer.concat(chunks))
      response.writeHead(204).end()
      return
    }
    const body = downloads.get(request.url ?? '')
    if (!body) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-length': body.byteLength }).end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    uploads,
    downloads,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
