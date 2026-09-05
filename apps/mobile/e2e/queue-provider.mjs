// Deterministic, local-only Responses fixture. POST /release completes held turns.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
const held = new Set()
const requests = []
http.createServer(async (req, res) => {
  if (req.url === '/release') { for (const finish of held) finish(); held.clear(); res.end('released'); return }
  if (req.url === '/requests') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(requests)); return }
  if (req.url !== '/v1/responses') { res.writeHead(404).end(); return }
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  const last = [...(Array.isArray(body.input) ? body.input : [])].reverse().find((item) => item.role === 'user')
  const prompt = typeof body.input === 'string' ? body.input : typeof last?.content === 'string' ? last.content
    : (last?.content ?? []).filter((item) => item.type === 'input_text').map((item) => item.text).join(' ')
  requests.push({ prompt, model: body.model, input: body.input, at: Date.now() })
  const id = `resp_${randomUUID()}`
  const text = `Completed: ${prompt}`
  const item = { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
  const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: body.model,
    output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }
  if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response)); return }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  let sequence = 0
  const event = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload })}\n\n`)
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } })
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 1000)
  const finish = () => {
    clearInterval(heartbeat)
    if (res.destroyed) return
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } })
    event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
    event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text })
    event('response.output_item.done', { output_index: 0, item })
    event('response.completed', { response })
    res.end()
  }
  res.on('close', () => { clearInterval(heartbeat); held.delete(finish) })
  if (prompt.startsWith('HOLD')) held.add(finish)
  else setTimeout(finish, 300)
}).listen(8092, '127.0.0.1', () => console.log('Queue fixture listening on 8092'))
