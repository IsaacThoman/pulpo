// Seeds a local Pulpo stack with chats whose messages carry the HTML preview fixtures. Sending non-image files
// requires Agent mode and a workspace, so the chats are imported with completed turns; the placeholder provider is
// never called. Local, disposable stacks only.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const base = process.env.PULPO_URL ?? 'http://localhost:8080'
const account = { name: 'HTML Preview Tester', username: 'html_preview', email: 'html-preview@example.test', password: 'Html-preview-test-2026' }
const fixtures = [
  { file: 'octopus-flashcards.html', title: 'Octopus flash cards', prompt: 'Here are the octopus flash cards I made. Can you check them?', reply: 'They look great — open the attachment to quiz yourself.' },
  { file: 'sandbox-probe.html', title: 'Sandbox probe', prompt: 'Sandbox probe for the HTML preview.', reply: 'Open the attachment to run the checks.' },
]

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Seed only a local stack.')

let cookie = ''
async function api(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), origin: base },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = response.headers.getSetCookie?.() ?? []
  if (setCookie.length) cookie = setCookie.map((value) => value.split(';')[0]).join('; ')
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

const { required } = await api('GET', '/api/auth/setup-status')
if (required) await api('POST', '/api/auth/setup', account)
else await api('POST', '/api/auth/login', { email: account.email, password: account.password })

const modelId = 'html-preview-fixture'
const { data: models = [] } = await api('GET', '/api/admin/models')
if (!models.some((model) => model.id === modelId)) {
  const { data: providers } = await api('GET', '/api/admin/providers')
  const provider = providers.find((existing) => existing.name === 'HTML preview fixture')
    ?? await api('POST', '/api/admin/providers', { name: 'HTML preview fixture', baseUrl: 'https://example.com/v1', apiKey: 'test-only' })
  await api('POST', '/api/admin/models', {
    id: modelId, providerConnectionId: provider.id, upstreamModelId: 'fixture', name: 'HTML Preview Fixture',
    contextWindow: 32000, maxOutputTokens: 1000, compactionEnabled: false,
    inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0,
  })
}

const exported = { chats: [], responses: [] }
for (const fixture of fixtures) {
  const bytes = await readFile(new URL(`html-preview/${fixture.file}`, import.meta.url))
  const { attachment, uploadUrl, uploadHeaders } = await api('POST', '/api/attachments', {
    originalName: fixture.file, mimeType: 'text/html', sizeBytes: bytes.byteLength,
  })
  const absoluteUploadUrl = new URL(uploadUrl, base)
  const upload = await fetch(absoluteUploadUrl, {
    method: 'PUT',
    headers: { ...uploadHeaders, ...(absoluteUploadUrl.origin === base ? { cookie } : {}) },
    body: bytes,
  })
  if (!upload.ok) throw new Error(`Upload failed: ${upload.status} ${await upload.text()}`)
  await api('POST', `/api/attachments/${attachment.id}/confirm`)
  const chatId = randomUUID()
  const responseId = randomUUID()
  const now = new Date().toISOString()
  exported.chats.push({ id: chatId, title: fixture.title, modelId, activeResponseId: responseId, createdAt: now, updatedAt: now })
  exported.responses.push({
    id: responseId, chatId, modelId, status: 'completed', createdAt: now, completedAt: now,
    input: [{ role: 'user', content: [{ type: 'input_text', text: fixture.prompt }, { type: 'input_file', attachment_id: attachment.id }] }],
    output: [{ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: fixture.reply, annotations: [] }] }],
  })
}
const result = await api('POST', '/api/chats/import', { source: 'pulpo', data: exported })
console.log(`Imported ${result.imported} chats. Sign in as ${account.email} / ${account.password}.`)
