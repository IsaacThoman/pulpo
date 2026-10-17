// A second device on a Files document, for the acceptance runs: it joins through the same
// provider the apps use and edits, suggests, reads, or keeps a caret open. Run from the
// repository root after files-seed.mjs (which saved the session token):
//   node apps/mobile/e2e/files-peer.mjs read "Ideas.md"
//   node apps/mobile/e2e/files-peer.mjs write "Ideas.md" "# New content"   (replaces, as a minimal diff)
//   node apps/mobile/e2e/files-peer.mjs append "Ideas.md" "A new paragraph"
//   node apps/mobile/e2e/files-peer.mjs suggest "Ideas.md" "Suggested replacement Markdown"
//   node apps/mobile/e2e/files-peer.mjs presence "Ideas.md" 30   (stays joined for 30 s with a caret)
import { readFile } from 'node:fs/promises'
import { io } from 'socket.io-client'
import * as Y from 'yjs'
import { applyMarkdownToYDoc, applyNodeToYDoc, mergeMarkdown, ydocToMarkdown, ydocToNode } from '../../../packages/client-core/dist/doc-schema/index.js'
import { SocketIOYProvider } from '../../../packages/client-core/dist/doc-sync/index.js'

const base = process.env.FILES_BASE_URL ?? 'http://localhost:8191'
const [command, name, argument] = process.argv.slice(2)
if (!command || !name) throw new Error('Usage: files-peer.mjs <read|write|append|suggest|presence> <document name> [text|seconds]')
const { token } = JSON.parse(await readFile('/tmp/pulpo-files-e2e.json', 'utf8'))

async function findDoc(folderId = null) {
  const response = await fetch(`${base}/api/files${folderId ? `?parentId=${folderId}` : ''}`, { headers: { authorization: `Bearer ${token}` } })
  const listing = await response.json()
  for (const node of listing.children) {
    if (node.kind === 'doc' && node.name === name) return node
  }
  for (const node of listing.children) {
    if (node.kind === 'folder' && !node.systemRole) {
      const found = await findDoc(node.id)
      if (found) return found
    }
  }
  return null
}

const node = await findDoc()
if (!node) throw new Error(`No document named ${name}`)
const socket = io(base, { path: '/socket.io', transports: ['websocket'], auth: { sessionToken: token } })
const doc = new Y.Doc()
const provider = new SocketIOYProvider(node.id, doc)
provider.awareness.setLocalStateField('user', { name: 'Safari on macOS', color: '#db2777' })
provider.attach(socket)
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Not synced: ${JSON.stringify(provider.status)}`)), 15_000)
  provider.onStatus((status) => {
    if (status.state === 'synced') { clearTimeout(timer); resolve() }
    if (status.state === 'error' || status.state === 'closed') { clearTimeout(timer); reject(new Error(JSON.stringify(status))) }
  })
})

const settle = () => new Promise((resolve) => {
  const check = () => provider.status.state === 'synced' ? resolve() : setTimeout(check, 50)
  setTimeout(check, 120)
})

switch (command) {
  case 'read':
    console.log(ydocToMarkdown(doc, 'base'))
    break
  case 'proposed':
    console.log(ydocToMarkdown(doc, 'proposed'))
    break
  case 'write':
    applyMarkdownToYDoc(doc, argument ?? '')
    await settle()
    break
  case 'append':
    applyMarkdownToYDoc(doc, `${ydocToMarkdown(doc, 'proposed').trimEnd()}\n\n${argument ?? 'Appended from another device'}\n`)
    await settle()
    break
  case 'suggest': {
    const merged = mergeMarkdown(ydocToNode(doc), argument ?? '', { mode: 'suggest', changeId: crypto.randomUUID() })
    applyNodeToYDoc(doc, merged.doc)
    await settle()
    console.log(`${merged.hunks} suggestion(s)`)
    break
  }
  case 'presence': {
    // A caret at the start of the first paragraph's text, so the other device shows a label.
    const first = doc.getXmlFragment('default').get(0)
    const text = first instanceof Y.XmlElement ? first.get(0) : null
    if (text) {
      const at = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, 4))
      provider.awareness.setLocalStateField('cursor', { anchor: at, head: at })
    }
    await new Promise((resolve) => setTimeout(resolve, Number(argument ?? 20) * 1000))
    break
  }
  default:
    throw new Error(`Unknown command ${command}`)
}
provider.destroy()
socket.close()
