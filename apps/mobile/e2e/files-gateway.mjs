// Local gateway for the Files acceptance runs: serves the built web app, forwards HTTP and
// WebSockets to the API, and lets a test cut the connection. Run from the repository root.
//   FILES_GATEWAY_PORT (8191) → FILES_API_PORT (8194); controls on FILES_CONTROL_PORT (8195).
//   POST {"online": false} or {"realtime": false} to the control port to drop traffic.
import http from 'node:http'
import net from 'node:net'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const gatewayPort = Number(process.env.FILES_GATEWAY_PORT ?? 8191)
const apiPort = Number(process.env.FILES_API_PORT ?? 8194)
const controlPort = Number(process.env.FILES_CONTROL_PORT ?? 8195)
const root = resolve('apps/web/dist')
const state = { online: true, realtime: true }
const sockets = new Set()
const requests = []
const types = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon',
}

http.createServer(async (req, res) => {
  if (!req.url.startsWith('/api/') && !req.url.startsWith('/socket.io') && !req.url.startsWith('/health')) {
    const path = resolve(root, `.${decodeURIComponent(req.url.split('?')[0])}`)
    if (!path.startsWith(`${root}/`) && path !== root) return res.writeHead(403).end()
    try {
      const data = await readFile(path)
      res.setHeader('content-type', types[extname(path)] ?? 'application/octet-stream')
      res.end(data)
    } catch {
      res.setHeader('content-type', 'text/html')
      res.end(await readFile(`${root}/index.html`))
    }
    return
  }
  const record = { at: Date.now(), method: req.method, path: req.url, status: null }
  requests.push(record)
  if (requests.length > 2_000) requests.splice(0, requests.length - 2_000)
  if (!state.online) {
    // Like a dead network: the connection closes without an answer.
    record.status = 0
    req.socket.destroy()
    return
  }
  const upstream = http.request({ hostname: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, (incoming) => {
    record.status = incoming.statusCode
    res.writeHead(incoming.statusCode, incoming.headers)
    incoming.pipe(res)
  })
  upstream.on('error', () => { record.status = 502; res.writeHead(502).end() })
  req.pipe(upstream)
}).on('upgrade', (req, socket, head) => {
  if (!state.online || !state.realtime) return socket.destroy()
  const upstream = net.connect(apiPort, '127.0.0.1', () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  sockets.add(socket)
  socket.on('close', () => { sockets.delete(socket); upstream.destroy() })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
}).listen(gatewayPort, '0.0.0.0')

http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const update = JSON.parse(raw || '{}')
    for (const key of Object.keys(state)) if (key in update) state[key] = Boolean(update[key])
    if (!state.online || !state.realtime) for (const socket of sockets) socket.destroy()
  }
  const since = Number(new URL(req.url, 'http://localhost').searchParams.get('since') ?? 0)
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ state, requests: requests.filter((request) => request.at >= since) }))
}).listen(controlPort, '127.0.0.1', () => console.log(`Files gateway ${gatewayPort} → API ${apiPort}; controls ${controlPort}`))
