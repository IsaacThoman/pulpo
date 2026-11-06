// End-to-end test of text and code files as live documents, against a running Pulpo API and its
// database (local and disposable: it creates an account, files, and a chat):
//   PULPO_API_URL=http://127.0.0.1:3000 DATABASE_URL=postgres://… npm run test:live-text -w @pulpo/web
// Install the browser once with: npx playwright install chromium
// With PULPO_SCREENSHOTS=<dir> it also saves screenshots of the editor in light and dark.
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
const root = new URL('..', import.meta.url).pathname
const serverRoot = new URL('../../server', import.meta.url).pathname
const account = { name: 'Live Text Tester', username: 'live_text', email: process.env.PULPO_TEST_EMAIL ?? 'live-text@example.test', password: process.env.PULPO_TEST_PASSWORD ?? 'Live-text-test-2026' }
const scratch = mkdtempSync(join(tmpdir(), 'pulpo-live-text-'))

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
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
  // Small files render every line, so the lines on screen are the whole text (without other
  // sessions' cursors, which are widgets inside the lines).
  const readLines = () => [...document.querySelectorAll('.cm-content .cm-line')].map((line) => {
    const copy = line.cloneNode(true)
    for (const widget of copy.querySelectorAll('.cm-ySelectionCaret, .cm-widgetBuffer')) widget.remove()
    return copy.textContent.replaceAll('\u2060', '')
  }).join('\n')
  const linesOf = (page) => page.evaluate(readLines)
  const waitForText = async (page, expected) => {
    try {
      await page.waitForFunction(`(${readLines})() === ${JSON.stringify(expected)}`, undefined, { timeout: 15_000, polling: 100 })
    } catch (error) {
      throw new Error(`Expected ${JSON.stringify(expected)}, the editor shows ${JSON.stringify(await linesOf(page))}`, { cause: error })
    }
  }
  const openFile = async (page, id) => {
    await page.goto(`${base}/files/d/${id}`)
    await page.locator('.cm-content').waitFor()
    await page.getByText('Synced').waitFor({ timeout: 15_000 })
  }

  // A new code file opens in the editor, with its language and the file's encoding shown.
  const unique = randomUUID().slice(0, 8)
  const doc = await request('POST', '/api/files/docs', { parentId: null, name: `greet-${unique}.py` })
  assert.equal(doc.format, 'text')
  const first = watch(await context.newPage())
  await openFile(first, doc.id)
  await first.getByText('Python').waitFor()
  await first.getByText('UTF-8', { exact: true }).waitFor()
  await first.locator('.cm-content').click()
  await first.keyboard.type('print("hello")')
  await first.keyboard.press('Enter')
  await waitForText(first, 'print("hello")\n')
  await first.locator('.pulpo-tk-string').first().waitFor()

  // A second tab sees the first tab's edit and its cursor, and its own edit reaches the first.
  const second = watch(await context.newPage())
  await openFile(second, doc.id)
  await waitForText(second, 'print("hello")\n')
  await first.locator('.cm-content').click()
  await first.keyboard.press('ArrowUp')
  await second.locator('.cm-ySelectionCaret').first().waitFor({ timeout: 10_000 })
  await second.locator('.cm-content').click()
  await second.keyboard.press('ControlOrMeta+End')
  await second.keyboard.type('# from the second tab')
  await waitForText(first, 'print("hello")\n# from the second tab')
  await first.locator('.cm-ySelectionCaret').first().waitFor({ timeout: 10_000 })
  await second.close()
  await first.bringToFront()

  // Undo in the first tab reverts only its own typing, never the other tab's.
  await first.locator('.cm-content').click()
  await first.keyboard.press('ControlOrMeta+End')
  await first.keyboard.type(' ok')
  await waitForText(first, 'print("hello")\n# from the second tab ok')
  await first.getByRole('button', { name: 'Undo' }).click()

  await waitForText(first, 'print("hello")\n# from the second tab')

  // The edit is stored: once synced, a reload shows it.
  await first.waitForTimeout(200)
  await first.getByText('Synced').waitFor()
  await first.reload()
  await first.locator('.cm-content').waitFor()
  await waitForText(first, 'print("hello")\n# from the second tab')

  // Downloading gives the real file.
  const [download] = await Promise.all([first.waitForEvent('download'), first.getByRole('button', { name: 'Download', exact: true }).click()])
  assert.equal(download.suggestedFilename(), `greet-${unique}.py`)
  assert.equal(readFileSync(await download.path(), 'utf8'), 'print("hello")\n# from the second tab')
  // The server's export, which agents pull, matches.
  const exported = await context.request.fetch(`${base}/api/files/${doc.id}/export`)
  assert.equal(await exported.text(), 'print("hello")\n# from the second tab')
  assert.equal(exported.headers()['content-disposition'].startsWith('attachment'), true)

  // Find and replace, line wrapping, and indentation are on the toolbar.
  await first.getByRole('button', { name: 'Find and replace' }).click()
  await first.locator('.cm-search input[name=search]').waitFor()
  await first.keyboard.press('Escape')
  await first.getByRole('button', { name: 'Wrap lines' }).click()
  assert.equal(await first.getByRole('button', { name: 'Wrap lines' }).getAttribute('aria-pressed'), 'true')
  await first.getByRole('button', { name: 'Wrap lines' }).click()
  await first.getByRole('button', { name: 'Indentation' }).click()
  await first.getByRole('menuitem', { name: 'Tab width 4' }).click()
  await first.getByRole('button', { name: 'Indentation' }).getByText('Tabs: 4').waitFor()

  if (screenshots) {
    await first.locator('.cm-content').click()
    await first.keyboard.press('ControlOrMeta+End')
    await first.keyboard.press('Enter')
    await first.keyboard.insertText('def greet(name: str) -> str:\n    """Say hello."""\n    return f"Hello, {name}!"\n\nfor who in ["Ada", "Grace"]:\n    print(greet(who))  # 2 lines\n')
    await first.waitForTimeout(400)
    await first.screenshot({ path: join(screenshots, 'text-editor-light.png') })
    await first.evaluate(() => document.documentElement.classList.add('dark'))
    await first.waitForTimeout(300)
    await first.screenshot({ path: join(screenshots, 'text-editor-dark.png') })
    await first.evaluate(() => document.documentElement.classList.remove('dark'))
  }

  // An uploaded code file with CRLF line breaks and a byte order mark opens for editing directly,
  // and downloads byte for byte.
  const original = Buffer.from('﻿const answer = 42\r\nconsole.log(answer)\r\n')
  const reservation = await request('POST', '/api/files/uploads', { parentId: null, name: `crlf-${unique}.js`, mimeType: 'text/javascript', sizeBytes: original.byteLength })
  const uploadUrl = new URL(reservation.uploadUrl, base)
  const put = await context.request.fetch(uploadUrl.toString(), { method: 'PUT', data: original, headers: { ...reservation.uploadHeaders, origin: base } })
  assert.ok(put.ok(), `upload: ${put.status()} ${await put.text()}`)
  await request('POST', `/api/files/${reservation.node.id}/confirm`)
  await first.goto(`${base}/files/d/${reservation.node.id}`)
  await first.getByRole('button', { name: 'Edit' }).click()
  await first.locator('.cm-content').waitFor()
  await waitForText(first, 'const answer = 42\nconsole.log(answer)\n')
  await first.getByText('UTF-8 BOM').waitFor()
  await first.getByText('CRLF', { exact: true }).waitFor()
  const [converted] = await Promise.all([first.waitForEvent('download'), first.getByRole('button', { name: 'Download', exact: true }).click()])
  assert.deepEqual([...readFileSync(await converted.path())], [...original])

  // An HTML file previews as it is edited, inside the sandbox.
  const page = await request('POST', '/api/files/docs', { parentId: null, name: `page-${unique}.html` })
  await openFile(first, page.id)
  await first.locator('.cm-content').click()
  await first.keyboard.insertText('<h1>Hello preview</h1>')
  await first.getByRole('button', { name: 'Preview' }).click()
  const frame = first.frameLocator(`iframe[title="Preview of page-${unique}.html"]`)
  await frame.getByText('Hello preview').waitFor({ timeout: 15_000 })
  await first.locator('.cm-content').click()
  await first.keyboard.press('ControlOrMeta+End')
  await first.keyboard.insertText('<p>Second paragraph</p>')
  await frame.getByText('Second paragraph').waitFor({ timeout: 15_000 })
  if (screenshots) await first.screenshot({ path: join(screenshots, 'html-preview-light.png') })

  // An agent suggests a new version from a chat; the reply's change list shows its diff, and
  // accepting it changes the document.
  const modelId = 'live-text-fixture'
  const { data: models = [] } = await request('GET', '/api/admin/models')
  if (!models.some((model) => model.id === modelId)) {
    const { data: providers } = await request('GET', '/api/admin/providers')
    const provider = providers.find((existing) => existing.name === 'Live text fixture')
      ?? await request('POST', '/api/admin/providers', { name: 'Live text fixture', baseUrl: 'https://example.com/v1', apiKey: 'test-only' })
    await request('POST', '/api/admin/models', {
      id: modelId, providerConnectionId: provider.id, upstreamModelId: 'fixture', name: 'Live Text Fixture',
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
      chats: [{ id: chatId, title: `Improve greet-${unique}.py`, modelId, activeResponseId: responseId, createdAt: now, updatedAt: now }],
      responses: [{
        id: responseId, chatId, modelId, status: 'completed', createdAt: now, completedAt: now,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Make the greeting friendlier.' }] }],
        output: [{ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'I suggested a friendlier greeting.', annotations: [] }] }],
      }],
    },
  })
  const chats = await request('GET', '/api/chats')
  const chat = (chats.data ?? chats.chats ?? chats).find((item) => item.title === `Improve greet-${unique}.py`)
  assert.ok(chat, 'the imported chat is listed')
  const detail = await request('GET', `/api/chats/${chat.id}`)
  const reply = (detail.responses ?? detail.data?.responses ?? []).at(-1)?.id ?? detail.activeResponseId ?? detail.chat?.activeResponseId
  assert.ok(reply, 'the imported reply has an id')
  const proposal = join(scratch, 'proposal.py')
  const current = await (await context.request.fetch(`${base}/api/files/${doc.id}/export`)).text()
  writeFileSync(proposal, current.replace('print("hello")', 'print("hello, friend")'))
  execFileSync('npx', ['tsx', 'scripts/seed-live-suggestion.ts', chat.id, reply, doc.id, proposal], { cwd: serverRoot, env: process.env, stdio: 'inherit' })
  await first.goto(`${base}/c/${chat.id}`)
  await first.getByRole('button', { name: `Show the changes to greet-${unique}.py` }).click()
  const dialog = first.getByRole('dialog', { name: `Changes to greet-${unique}.py` })
  await dialog.getByText('print("hello, friend")').waitFor()
  await dialog.getByText(/^\d+ lines? changes?$/).waitFor()
  if (screenshots) await first.screenshot({ path: join(screenshots, 'suggestion-diff-light.png') })
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await first.getByRole('button', { name: `Accept the change to greet-${unique}.py` }).click()
  await first.getByText('accepted').waitFor()
  await openFile(first, doc.id)
  await waitForText(first, current.replace('print("hello")', 'print("hello, friend")'))

  assert.deepEqual(errors, [])
  console.log('live text: ok')
} finally {
  await browser?.close()
  await server?.close()
}
