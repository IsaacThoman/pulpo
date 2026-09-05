// Local QA gateway: serves the built web app and injects transport failures.
// API: 8094 -> gateway: 8091. Control endpoint: http://127.0.0.1:8095.
import http from 'node:http'
import net from 'node:net'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const state = { online: true, realtime: true, nextQueueFailure: null }
const sockets = new Set()
const requests = []
const root = resolve('apps/web/dist')
http.createServer(async (req, res) => {
  if (!req.url.startsWith('/api/') && !req.url.startsWith('/socket.io') && !req.url.startsWith('/health')) {
    const path = resolve(root, `.${decodeURIComponent(req.url.split('?')[0])}`)
    if (!path.startsWith(`${root}/`) && path !== root) return res.writeHead(403).end()
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' }
    try { const data = await readFile(path); res.setHeader('content-type', types[extname(path)] ?? 'application/octet-stream'); res.end(data) }
    catch { res.setHeader('content-type', 'text/html'); res.end(await readFile(`${root}/index.html`)) }
    return
  }
  const record = { method: req.method, path: req.url, status: null }
  requests.push(record)
  const queuePost = req.method === 'POST' && /\/queued-messages$/.test(req.url)
  const fault = queuePost ? state.nextQueueFailure : null
  if (queuePost) state.nextQueueFailure = null
  if (!state.online || fault === '500' || fault === '400') {
    record.status = fault === '400' ? 400 : 503
    res.writeHead(record.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'qa_injected', message: 'Injected local QA failure' } }))
    return
  }
  const upstream = http.request({ hostname: '127.0.0.1', port: 8094, path: req.url, method: req.method, headers: req.headers }, incoming => {
    record.status = incoming.statusCode
    if (fault === 'drop') { incoming.resume(); incoming.on('end', () => res.destroy()); return }
    res.writeHead(incoming.statusCode, incoming.headers)
    incoming.pipe(res)
  })
  upstream.on('error', () => { record.status = 502; res.writeHead(502).end() })
  req.pipe(upstream)
}).on('upgrade', (req, socket, head) => {
  if (!state.online || !state.realtime) return socket.destroy()
  const upstream = net.connect(8094, '127.0.0.1', () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  sockets.add(socket)
  socket.on('close', () => { sockets.delete(socket); upstream.destroy() })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
}).listen(8091, '127.0.0.1')
http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk
    const update = JSON.parse(raw || '{}')
    for (const key of Object.keys(state)) if (key in update) state[key] = update[key]
    if (!state.online || !state.realtime) for (const socket of sockets) socket.destroy()
  }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ state, requests }))
}).listen(8095, '127.0.0.1', () => console.log('Local QA gateway 8091; controls 8095; upstream 8094'))
