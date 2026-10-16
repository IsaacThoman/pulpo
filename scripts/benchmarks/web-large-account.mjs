import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

// Production store operation, without mounted subscribers, HTTP or database work.
const repo = fileURLToPath(new URL('../../', import.meta.url))
const web = path.join(repo, 'apps/web')
const temporary = await mkdtemp(path.join(web, 'node_modules/.large-account-'))
const outDir = await mkdtemp(path.join(os.tmpdir(), 'pulpo-large-account-'))
const baselineIndex = process.argv.indexOf('--baseline')
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1]
assert(baselineIndex < 0 || baseline, '--baseline requires a commit')
const baselineStore = baseline && execFileSync('git', ['show', `${baseline}:apps/web/src/stores/chat.ts`], { cwd: repo, encoding: 'utf8' })
const results = []
let baselineApplied = false
let browser, server
try {
  await writeFile(path.join(temporary, 'index.html'), '<script type="module" src="./fixture.ts"></script>')
  await writeFile(path.join(temporary, 'fixture.ts'), `
import { useChat } from ${JSON.stringify(path.join(web, 'src/stores/chat.ts'))}
import { sidebarChatGroups } from ${JSON.stringify(path.join(web, 'src/features/sidebar/chat-groups.ts'))}
import ${JSON.stringify(path.join(web, 'src/i18n/index.ts'))}

// Frozen original Sidebar.tsx grouping loop; the optimized path calls the actual shared helper.
function baselineGroups(chats) {
  const inFolders = new Map(), loose = []
  for (const c of chats) {
    if (c.pinned || c.inFilesRoot) continue
    if (!c.folderId) loose.push(c)
    else inFolders.set(c.folderId, [...inFolders.get(c.folderId) ?? [], c])
  }
  return { inFolders, loose }
}
let source, rows, messages
window.prepare = count => {
  source = Array.from({ length: count }, (_, index) => ({
    id: 'chat-' + index, title: 'Chat ' + index, modelId: 'model', messages: [],
    createdAt: 1000, updatedAt: 1000, pinned: false, folderId: 'archive', sortOrder: index,
    temporary: false, expiresAt: null, expired: false, tags: [],
  }))
  messages = [{ id: 'retained-answer', role: 'assistant', content: 'Cached transcript', timestamp: 1000, done: true }]
  source[0].messages = messages
  rows = [...source].reverse().map(chat => ({
    id: chat.id, title: chat.title, modelId: chat.modelId, pinned: false, folderId: chat.folderId,
    createdAt: new Date(1000).toISOString(), updatedAt: new Date(2000).toISOString(),
    activeResponseId: null, activeBranchLeafId: null,
  }))
  for (let index = 0; index < 25; index++) source.push({ ...source[1], id: 'local-' + index, provisional: true })
}
window.sample = operation => {
  useChat.setState({ chats: source, activeTemporaryChatId: null, streamingIds: [], responseSequences: {}, responseChatIds: {} })
  const start = performance.now()
  if (operation === 'summaries') {
    useChat.getState().replaceSummaries(rows)
    const elapsedMs = performance.now() - start
    const actual = useChat.getState().chats
    if (actual.length !== rows.length + 25 || actual[25].id !== rows[0].id || actual.at(-1).messages !== messages) throw Error('Summary behavior changed')
    return elapsedMs
  }
  const result = ${baseline ? 'baselineGroups' : 'sidebarChatGroups'}(source)
  const elapsedMs = performance.now() - start
  if (result.loose.length || result.inFolders.get('archive').length !== source.length || result.inFolders.get('archive')[0] !== source[0]) throw Error('Folder behavior changed')
  return elapsedMs
}
window.benchReady = true
`)
  await build({
    root: temporary, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error',
    plugins: baseline ? [{
      name: 'baseline-production-store', enforce: 'pre',
      transform(_code, id) {
        if (id !== path.join(web, 'src/stores/chat.ts')) return
        baselineApplied = true
        return baselineStore
      },
    }] : [],
    build: { outDir, rollupOptions: { input: path.join(temporary, 'index.html') } },
  })
  assert(!baseline || baselineApplied, 'The baseline production store was not substituted')
  server = await preview({ root: temporary, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.resolvedUrls.local[0])
  await page.waitForFunction(() => window.benchReady)
  const cdp = await page.context().newCDPSession(page)
  for (const count of [1000, 5000, 20000]) {
    await page.evaluate(count => window.prepare(count), count)
    for (const operation of ['summaries', 'folder-grouping']) {
      const samples = []
      for (let repeat = 0; repeat < 8; repeat++) {
        await cdp.send('HeapProfiler.collectGarbage')
        const ms = await page.evaluate(operation => window.sample(operation), operation)
        if (repeat) samples.push(ms)
      }
      const sample = { version: baseline ?? 'working-tree', count, provisional: 25, operation, medianMs: [...samples].sort((a, b) => a - b)[3], samplesMs: samples }
      results.push(sample)
      console.log(JSON.stringify(sample))
    }
  }
  assert.deepEqual(errors, [])
  if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.httpServer.close(resolve))
  await rm(temporary, { recursive: true, force: true })
  await rm(outDir, { recursive: true, force: true })
}
