// End-to-end test of Jupyter notebooks as live documents, against a running Pulpo API and its
// database (local and disposable: it creates an account, files, and a chat):
//   PULPO_API_URL=http://127.0.0.1:3000 DATABASE_URL=postgres://… npm run test:live-notebook -w @pulpo/web
// Install the browser once with: npx playwright install chromium
// With PULPO_NOTEBOOK_PYTHON=<python with nbformat> downloads are also checked with nbformat.validate.
// With PULPO_SCREENSHOTS=<dir> it also saves screenshots of the editor and the review diff in light and dark.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const api = process.env.PULPO_API_URL ?? 'http://127.0.0.1:3000'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) throw new Error('Run against a local, disposable API only.')
const screenshots = process.env.PULPO_SCREENSHOTS
const python = process.env.PULPO_NOTEBOOK_PYTHON
const root = new URL('..', import.meta.url).pathname
const serverRoot = new URL('../../server', import.meta.url).pathname
const fixture = new URL('../../../packages/client-core/src/office/notebook/fixtures/generated-analysis.ipynb', import.meta.url).pathname
// An instance set up already can lend an admin account (PULPO_TEST_EMAIL and PULPO_TEST_PASSWORD).
const account = {
  name: 'Notebook Tester',
  username: 'live_notebook',
  email: process.env.PULPO_TEST_EMAIL ?? 'live-notebook@example.test',
  password: process.env.PULPO_TEST_PASSWORD ?? 'Live-notebook-test-2026',
}
const scratch = mkdtempSync(join(tmpdir(), 'pulpo-live-notebook-'))

/** Checks a notebook file with nbformat when a Python with it is configured, and returns it parsed. */
function validated(bytes) {
  if (python) {
    const path = join(scratch, `${randomUUID()}.ipynb`)
    writeFileSync(path, bytes)
    execFileSync(python, ['-I', '-c', 'import sys, nbformat; nbformat.validate(nbformat.read(sys.argv[1], as_version=4))', path], { stdio: 'inherit' })
  }
  return JSON.parse(Buffer.from(bytes).toString('utf8'))
}

let server
let browser
try {
  server = await createServer({
    root,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: { '/api': api, '/health': api, '/socket.io': { target: api.replace(/^http/, 'ws'), ws: true } },
    },
  })
  await server.listen()
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
  const errors = []
  const request = async (method, path, body) => {
    const response = await context.request.fetch(`${base}${path}`, { method, data: body, headers: { origin: base } })
    const text = await response.text()
    if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()}: ${text}`)
    return text ? JSON.parse(text) : null
  }
  const { required } = await request('GET', '/api/auth/setup-status')
  if (required) await request('POST', '/api/auth/setup', account)
  else await request('POST', '/api/auth/login', { email: account.email, password: account.password })

  const watch = (page) => {
    page.on('pageerror', (error) => errors.push(error.message))
    return page
  }
  const cells = (page) => page.locator('[data-cell-key]')
  /** The cells' sources as the editors show them (without other sessions' cursors). */
  const sources = (page) => page.evaluate(() => [...document.querySelectorAll('[data-cell-key]')].map((cell) => {
    const lines = cell.querySelectorAll('.cm-content .cm-line')
    if (!lines.length) return cell.querySelector('[data-cell-source], pre, .prose')?.textContent ?? cell.textContent
    return [...lines].map((line) => {
      const copy = line.cloneNode(true)
      for (const widget of copy.querySelectorAll('.cm-ySelectionCaret, .cm-widgetBuffer, .cm-placeholder')) widget.remove()
      return copy.textContent.replaceAll('⁠', '')
    }).join('\n')
  }))
  const waitForSources = async (page, check, what) => {
    try {
      await page.waitForFunction(async () => true)
      const deadline = Date.now() + 15_000
      for (;;) {
        const current = await sources(page)
        if (check(current)) return current
        if (Date.now() > deadline) throw new Error(`Expected ${what}; the cells show ${JSON.stringify(current)}`)
        await page.waitForTimeout(100)
      }
    } catch (error) {
      throw new Error(`Waiting for ${what}`, { cause: error })
    }
  }
  const openFile = async (page, id) => {
    await page.goto(`${base}/files/d/${id}`)
    await page.locator('[data-notebook-editor]').waitFor({ timeout: 20_000 })
    await page.getByText('Synced').waitFor({ timeout: 15_000 })
  }
  const notebookKeys = (page) => page.getByRole('list', { name: 'Notebook cells' })
  const waitForCount = (page, count) => page.waitForFunction((expected) => document.querySelectorAll('[data-cell-key]').length === expected, count, { timeout: 10_000 })

  // A new notebook opens with one empty code cell; typing, Esc, and Jupyter's keys build it up.
  const unique = randomUUID().slice(0, 8)
  const doc = await request('POST', '/api/files/docs', { parentId: null, name: `analysis-${unique}.ipynb` })
  assert.equal(doc.format, 'notebook')
  const first = watch(await context.newPage())
  await openFile(first, doc.id)
  assert.equal(await cells(first).count(), 1)
  await first.getByText('Python 3 (ipykernel)').waitFor()
  await cells(first).first().locator('.cm-content').click()
  await first.getByText('Edit mode').waitFor()
  await first.keyboard.type('import math')
  await first.keyboard.press('Escape')
  await first.getByText('Command mode').waitFor()
  await first.keyboard.press('b')
  await first.keyboard.press('m')
  await first.keyboard.press('Enter')
  await first.keyboard.type('# Results')
  // Shift+Enter leaves the Markdown cell rendered and adds a code cell after the last.
  await first.keyboard.press('Shift+Enter')
  await first.keyboard.type('print(math.pi)')
  await first.keyboard.press('Escape')
  await waitForSources(first, (current) => current.length === 3 && current[0] === 'import math' && current[2] === 'print(math.pi)', 'three cells')
  await cells(first).nth(1).getByRole('heading', { name: 'Results' }).waitFor()
  // A and D, D: insert above, then delete it again.
  await first.keyboard.press('a')
  await waitForCount(first, 4)
  await first.keyboard.press('d')
  await first.keyboard.press('d')
  await waitForCount(first, 3)
  // Move the last cell up with the toolbar, and back with undo.
  await first.getByRole('button', { name: 'Move cell up' }).first().click()
  await waitForSources(first, (current) => current[1] === 'print(math.pi)', 'the cell moved up')
  await first.getByRole('button', { name: 'Undo' }).click()
  await waitForSources(first, (current) => current[2] === 'print(math.pi)', 'the move undone')

  // A second tab sees the first's cells and where its user is, and its edits reach the first.
  const second = watch(await context.newPage())
  await openFile(second, doc.id)
  await waitForSources(second, (current) => current.length === 3 && current[2] === 'print(math.pi)', 'the cells in the second tab')
  // Switching back to the first tab, its cursor and cell show in the second.
  await first.bringToFront()
  await cells(first).first().locator('.cm-content').click()
  await first.keyboard.press('End')
  await cells(second).first().locator('.cm-ySelectionCaret').waitFor({ timeout: 10_000 })
  await cells(second).first().getByText(/Chrome on/).first().waitFor()
  await second.bringToFront()
  await cells(second).nth(2).locator('.cm-content').click()
  await second.keyboard.press('End')
  await second.keyboard.type('  # from the second tab')
  await waitForSources(first, (current) => current[2] === 'print(math.pi)  # from the second tab', 'the second tab\'s edit')
  // Concurrent structure: the second tab adds a cell while the first types into another.
  await second.keyboard.press('Escape')
  await second.keyboard.press('b')
  await first.bringToFront()
  await cells(first).first().locator('.cm-content').click()
  await first.keyboard.press('End')
  await first.keyboard.type(', os')
  await waitForSources(first, (current) => current.length === 4 && current[0] === 'import math, os', 'both changes')
  await waitForSources(second, (current) => current.length === 4 && current[0] === 'import math, os', 'both changes in the second tab')
  // Undo in the first tab takes back only its own typing.
  await first.keyboard.press('Escape')
  await first.getByRole('button', { name: 'Undo' }).click()
  await waitForSources(first, (current) => current[0] === 'import math' && current.length === 4, 'own typing undone')
  await second.close()
  await first.bringToFront()

  // Edits are stored: once synced, a reload shows them.
  await first.getByText('Synced').waitFor()
  await first.reload()
  await first.locator('[data-notebook-editor]').waitFor()
  const reloaded = await waitForSources(first, (current) => current.length === 4 && current[2] === 'print(math.pi)  # from the second tab', 'the cells after reloading')
  assert.equal(reloaded[0], 'import math')

  // Downloading gives a valid notebook, and the server's export matches.
  const [download] = await Promise.all([first.waitForEvent('download'), first.getByRole('button', { name: 'Download' }).click()])
  assert.equal(download.suggestedFilename(), `analysis-${unique}.ipynb`)
  const downloaded = validated(readFileSync(await download.path()))
  assert.deepEqual(downloaded.cells.map((cell) => cell.cell_type), ['code', 'markdown', 'code', 'code'])
  assert.deepEqual(downloaded.cells[1].source, ['# Results'])
  assert.equal(downloaded.nbformat_minor, 5)
  const exported = await context.request.fetch(`${base}/api/files/${doc.id}/export`)
  assert.deepEqual(JSON.parse(await exported.text()), downloaded)

  // An uploaded notebook with outputs opens for editing at once, shows its outputs, and downloads byte for byte.
  const original = readFileSync(fixture)
  const reservation = await request('POST', '/api/files/uploads', { parentId: null, name: `sales-${unique}.ipynb`, mimeType: 'application/x-ipynb+json', sizeBytes: original.byteLength })
  const put = await context.request.fetch(new URL(reservation.uploadUrl, base).toString(), { method: 'PUT', data: original, headers: { ...reservation.uploadHeaders, origin: base } })
  assert.ok(put.ok(), `upload: ${put.status()} ${await put.text()}`)
  await request('POST', `/api/files/${reservation.node.id}/confirm`)
  await first.goto(`${base}/files/d/${reservation.node.id}`)
  // Before Edit it shows in the read-only viewer.
  await first.locator('[data-preview-kind="notebook"]').waitFor()
  await first.getByRole('button', { name: 'Edit' }).click()
  await first.locator('[data-notebook-editor]').waitFor({ timeout: 20_000 })
  await first.getByRole('img').first().waitFor({ timeout: 15_000 })
  await first.locator('[data-output="error"]').getByText('ZeroDivisionError').first().waitFor()
  await first.frameLocator('iframe[title="Notebook output"]').first().getByText('month').waitFor({ timeout: 15_000 })
  const [unedited] = await Promise.all([first.waitForEvent('download'), first.getByRole('button', { name: 'Download' }).click()])
  assert.deepEqual([...readFileSync(await unedited.path())], [...original])
  // Clearing every output and collapsing one cell's are stored as Jupyter writes them.
  await notebookKeys(first).focus()
  await first.getByRole('button', { name: 'Clear outputs' }).click()
  await first.getByRole('menuitem', { name: 'Clear all outputs' }).click()
  await first.locator('[data-cell-outputs]').first().waitFor({ state: 'detached' })
  await first.waitForTimeout(500)
  const cleared = validated(Buffer.from(await (await context.request.fetch(`${base}/api/files/${reservation.node.id}/export`)).body()))
  assert.ok(cleared.cells.every((cell) => cell.cell_type !== 'code' || (cell.outputs.length === 0 && cell.execution_count === null)))
  await first.getByRole('button', { name: 'Undo' }).click()
  await first.locator('[data-cell-outputs]').first().waitFor()

  if (screenshots) {
    await first.goto(`${base}/files/d/${reservation.node.id}`)
    await first.locator('[data-notebook-editor]').waitFor()
    await first.getByRole('img').first().waitFor({ timeout: 15_000 })
    await cells(first).nth(2).click({ position: { x: 4, y: 4 } })
    await first.waitForTimeout(800)
    await first.screenshot({ path: join(screenshots, 'notebook-editor-light.png') })
    await first.evaluate(() => document.documentElement.classList.add('dark'))
    await first.waitForTimeout(800)
    await first.screenshot({ path: join(screenshots, 'notebook-editor-dark.png') })
    await first.evaluate(() => document.documentElement.classList.remove('dark'))
  }

  // An agent suggests a new version from a chat; the reply's change list shows the cell diff, and
  // accepting it changes the notebook.
  const modelId = 'live-notebook-fixture'
  const { data: models = [] } = await request('GET', '/api/admin/models')
  if (!models.some((model) => model.id === modelId)) {
    const { data: providers } = await request('GET', '/api/admin/providers')
    const provider = providers.find((existing) => existing.name === 'Live notebook fixture')
      ?? await request('POST', '/api/admin/providers', { name: 'Live notebook fixture', baseUrl: 'https://example.com/v1', apiKey: 'test-only' })
    await request('POST', '/api/admin/models', {
      id: modelId, providerConnectionId: provider.id, upstreamModelId: 'fixture', name: 'Live Notebook Fixture',
      contextWindow: 32000, maxOutputTokens: 1000, compactionEnabled: false,
      inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0,
    })
  }
  const chatId = randomUUID()
  const responseId = randomUUID()
  const now = new Date().toISOString()
  await request('POST', '/api/chats/import', {
    source: 'pulpo',
    data: {
      chats: [{ id: chatId, title: `Improve sales-${unique}.ipynb`, modelId, activeResponseId: responseId, createdAt: now, updatedAt: now }],
      responses: [{
        id: responseId, chatId, modelId, status: 'completed', createdAt: now, completedAt: now,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Use the real data file.' }] }],
        output: [{ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'I suggested reading sales.csv.', annotations: [] }] }],
      }],
    },
  })
  const chats = await request('GET', '/api/chats')
  const chat = (chats.data ?? chats.chats ?? chats).find((item) => item.title === `Improve sales-${unique}.ipynb`)
  assert.ok(chat, 'the imported chat is listed')
  const detail = await request('GET', `/api/chats/${chat.id}`)
  const reply = (detail.responses ?? detail.data?.responses ?? []).at(-1)?.id ?? detail.activeResponseId ?? detail.chat?.activeResponseId
  assert.ok(reply, 'the imported reply has an id')
  const proposed = JSON.parse(original.toString('utf8'))
  proposed.cells[2].source = ["df = pd.read_csv('sales.csv')\n", 'df']
  proposed.cells.splice(4, 0, { cell_type: 'markdown', id: 'notes', metadata: {}, source: ['## Notes'] })
  proposed.cells.splice(8, 1)
  const proposal = join(scratch, 'proposal.ipynb')
  writeFileSync(proposal, `${JSON.stringify(proposed, null, 1)}\n`)
  execFileSync('npx', ['tsx', 'scripts/seed-live-suggestion.ts', chat.id, reply, reservation.node.id, proposal], { cwd: serverRoot, env: process.env, stdio: 'inherit' })
  await first.goto(`${base}/c/${chat.id}`)
  await first.getByRole('button', { name: `Show the changes to sales-${unique}.ipynb` }).click()
  const dialog = first.getByRole('dialog', { name: `Changes to sales-${unique}.ipynb` })
  await dialog.locator('[data-notebook-diff]').waitFor()
  await dialog.getByText("df = pd.read_csv('sales.csv')").waitFor()
  await dialog.getByText('1 cell added · 1 cell removed · 1 cell edited').waitFor()
  await dialog.locator('[data-diff-cell="added"]').getByText('## Notes').waitFor()
  if (screenshots) {
    await first.waitForTimeout(300)
    await first.screenshot({ path: join(screenshots, 'notebook-diff-light.png') })
    await first.evaluate(() => document.documentElement.classList.add('dark'))
    await first.waitForTimeout(300)
    await first.screenshot({ path: join(screenshots, 'notebook-diff-dark.png') })
    await first.evaluate(() => document.documentElement.classList.remove('dark'))
  }
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await first.getByRole('button', { name: `Accept the change to sales-${unique}.ipynb` }).click()
  await first.getByText('accepted').waitFor()
  await openFile(first, reservation.node.id)
  await waitForSources(first, (current) => current.length === 9 && current[2] === "df = pd.read_csv('sales.csv')\ndf" && /Notes$/.test(current[4]), 'the accepted suggestion')

  // Run with agent opens a new chat with the notebook attached and the request ready to send.
  await first.getByRole('button', { name: 'Run with agent' }).click()
  await first.getByRole('textbox').filter({ hasText: /Run this notebook/ }).or(first.locator('textarea')).first().waitFor()
  await first.waitForFunction(() => [...document.querySelectorAll('textarea')].some((area) => area.value.startsWith('Run this notebook')), undefined, { timeout: 10_000 })

  assert.deepEqual(errors, [])
  console.log('live notebook: ok')
} finally {
  await browser?.close()
  await server?.close()
}
