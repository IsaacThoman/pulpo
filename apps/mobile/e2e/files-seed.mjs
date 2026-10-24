// Seeds the disposable Files acceptance account through the public API (see files-validation.md):
// a nested tree, documents with rich content, and uploaded files of several kinds. Run from the
// repository root against the gateway: `node apps/mobile/e2e/files-seed.mjs`. It refuses to run
// against anything but localhost.
import { writeFile } from 'node:fs/promises'

const base = process.env.FILES_BASE_URL ?? 'http://localhost:8191'
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('The Files seed only runs against a local instance')
const account = { name: 'Files Tester', username: 'files_tester', email: 'files@example.test', password: 'Files-test-only-2026' }

async function api(path, { method = 'GET', body, token, raw } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`)
  return text ? JSON.parse(text) : undefined
}

const config = await api('/api/mobile/config')
const device = { deviceLabel: 'Files acceptance seed', appType: 'mobile', platform: 'ios' }
const auth = config.setupRequired
  ? await api('/api/mobile/auth/setup', { method: 'POST', body: { ...account, ...device } })
  : await api('/api/mobile/auth/login', { method: 'POST', body: { email: account.email, password: account.password, ...device } })
const token = auth.session.token

const root = await api('/api/files', { token })
const byName = new Map(root.children.map((node) => [node.name, node]))
async function folder(parentId, name) {
  const existing = parentId === null ? byName.get(name) : (await api(`/api/files?parentId=${parentId}`, { token })).children.find((node) => node.name === name)
  return existing ?? api('/api/files/folders', { method: 'POST', token, body: { parentId, name } })
}
async function doc(parentId, name, markdown) {
  const listing = await api(parentId ? `/api/files?parentId=${parentId}` : '/api/files', { token })
  return listing.children.find((node) => node.name === name) ?? api('/api/files/docs', { method: 'POST', token, body: { parentId, name, markdown } })
}
async function upload(parentId, name, mimeType, bytes) {
  const listing = await api(parentId ? `/api/files?parentId=${parentId}` : '/api/files', { token })
  const existing = listing.children.find((node) => node.name === name)
  if (existing) return existing
  const reservation = await api('/api/files/uploads', { method: 'POST', token, body: { parentId, name, mimeType, sizeBytes: bytes.length } })
  const url = reservation.uploadUrl.startsWith('/') ? `${base}${reservation.uploadUrl}` : reservation.uploadUrl
  const put = await fetch(url, { method: 'PUT', body: bytes, headers: { ...reservation.uploadHeaders, ...(reservation.uploadUrl.startsWith('/') ? { authorization: `Bearer ${token}` } : {}) } })
  if (!put.ok) throw new Error(`PUT ${name} → ${put.status} ${await put.text()}`)
  return api(`/api/files/${reservation.node.id}/confirm`, { method: 'POST', token })
}

const projects = await folder(null, 'Projects')
const launch = await folder(projects.id, 'Launch')
const research = await folder(projects.id, 'Research')
await folder(null, 'Photos')
const plan = await doc(projects.id, 'Plan.md', `# Launch plan

The mobile Files release ships when **every** check below passes.

## Checklist

- [x] Shared document sync
- [ ] Native file browser
- [ ] Agent file scopes

## Notes

1. Keep edits offline-safe.
2. Never lose a keystroke.

> Documents are Yjs replicas; the server is just another peer.

\`\`\`ts
const editor = await openDocument('Plan.md')
\`\`\`

| Phase | Owner | Status |
| --- | --- | --- |
| Browser | Mobile | In progress |
| Editor | Mobile | Planned |
`)
await doc(launch.id, 'Announcement.md', '# Announcement\n\nPulpo Files is now on iPhone and Android.\n')
await doc(null, 'Ideas.md', 'Some ideas worth exploring:\n\n- Spotlight search for documents\n- Drag and drop on iPad\n')
await doc(research.id, 'Interviews.md', '## Interview notes\n\nPeople open documents from chat replies more than from the browser.\n')
// A 1×1 PNG, a tiny PDF, uploaded Markdown that converts cleanly, and Markdown that does not.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
await upload(null, 'Pixel.png', 'image/png', png)
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 100]/Parent 2 0 R/Resources<<>>>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
await upload(research.id, 'Report.pdf', 'application/pdf', pdf)
await upload(null, 'Uploaded notes.md', 'text/markdown', Buffer.from('# Uploaded notes\n\n- one\n- two\n'))
await upload(null, 'Messy notes.md', 'text/markdown', Buffer.from('# Messy notes\n\n* star bullet\n* another\n\n<b>raw html</b>\n'))
await upload(launch.id, 'budget.csv', 'text/csv', Buffer.from('item,cost\nicons,40\nservers,120\n'))

await writeFile('/tmp/pulpo-files-e2e.json', JSON.stringify({ token, account, planId: plan.id, projectsId: projects.id }, null, 2))
console.log(`Files acceptance account ready: ${account.email} / ${account.password}`)
