// End-to-end test of spreadsheets as live documents, against a running Pulpo API, its worker, and
// its database and Redis (local and disposable: it creates an account, files, and chats):
//   PULPO_API_URL=http://127.0.0.1:3000 DATABASE_URL=postgres://… REDIS_URL=redis://… npm run test:live-sheets -w @pulpo/web
// It checks downloads with openpyxl, from PULPO_SHEETS_VENV (default ~/.cache/pulpo-sheets-venv;
// see packages/client-core/scripts/sheets/setup-fidelity-env.sh).
// Install the browser once with: npx playwright install chromium
// With PULPO_SCREENSHOTS=<dir> it also saves screenshots of the editor in light and dark.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const api = process.env.PULPO_API_URL ?? 'http://127.0.0.1:3000'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) throw new Error('Run against a local, disposable API only.')
const screenshots = process.env.PULPO_SCREENSHOTS
const python = join(process.env.PULPO_SHEETS_VENV ?? join(homedir(), '.cache', 'pulpo-sheets-venv'), 'bin', 'python')
const root = new URL('..', import.meta.url).pathname
const serverRoot = new URL('../../server', import.meta.url).pathname
const account = { name: 'Live Sheets Tester', username: 'live_sheets', email: process.env.PULPO_TEST_EMAIL ?? 'live-sheets@example.test', password: process.env.PULPO_TEST_PASSWORD ?? 'Live-sheets-test-2026' }
const scratch = mkdtempSync(join(tmpdir(), 'pulpo-live-sheets-'))
// Python reads downloads from an empty directory of their own, with the script kept elsewhere.
const scripts = join(scratch, 'scripts')
mkdirSync(scripts)

/** Runs a short openpyxl script on a copy of `file` in a fresh, empty directory; returns its JSON output. */
function openpyxl(file, code, ...args) {
  const dir = mkdtempSync(join(scratch, 'xlsx-'))
  const copy = join(dir, 'book.xlsx')
  copyFileSync(file, copy)
  const script = join(scripts, `${randomUUID()}.py`)
  writeFileSync(script, `import json, sys\nimport openpyxl\npath = sys.argv[1]\n${code}\n`)
  return JSON.parse(execFileSync(python, ['-I', script, copy, ...args], { cwd: dir, encoding: 'utf8' }))
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
  const openFile = async (page, id) => {
    await page.goto(`${base}/files/d/${id}`)
    await page.locator('.pulpo-sheet canvas').first().waitFor()
    await page.locator('[data-sync-state="synced"]').waitFor({ timeout: 15_000 })
  }
  /** Selects a cell through the name box. */
  const go = async (page, ref) => {
    const box = page.getByLabel('Name box')
    await box.fill(ref)
    await box.press('Enter')
  }
  /** Types into cells from `ref` on: Tab between values, Enter after the last. */
  const typeRow = async (page, ref, values) => {
    await go(page, ref)
    for (const [index, value] of values.entries()) {
      await page.keyboard.type(value)
      await page.keyboard.press(index === values.length - 1 ? 'Enter' : 'Tab')
    }
  }
  /** Waits until the formula bar shows `expected` for the cell at `ref`. */
  const expectCell = async (page, ref, expected) => {
    await go(page, ref)
    const bar = page.getByLabel('Formula bar')
    try {
      await page.waitForFunction(([label, value]) => document.querySelector(`[aria-label="${label}"]`)?.value === value, ['Formula bar', expected], { timeout: 15_000, polling: 100 })
    } catch (error) {
      throw new Error(`Expected ${ref} to read ${JSON.stringify(expected)}, it reads ${JSON.stringify(await bar.inputValue())}`, { cause: error })
    }
  }
  const download = async (page, name) => {
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()])
    if (name) assert.equal(file.suggestedFilename(), name)
    const path = join(scratch, `${randomUUID()}.xlsx`)
    await file.saveAs(path)
    return path
  }

  // A new spreadsheet comes from the Files menu.
  const first = watch(await context.newPage())
  await first.goto(`${base}/files`)
  await first.getByRole('button', { name: 'New', exact: true }).click()
  await first.getByRole('menuitem', { name: 'New spreadsheet' }).click()
  // It opens in the editor with its name selected in the title; Enter keeps the name.
  await first.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Document name')
  await first.keyboard.press('Enter')
  let created
  for (let attempt = 0; attempt < 50 && !created; attempt++) {
    const { children } = await request('GET', '/api/files')
    created = children.filter((node) => node.format === 'sheet' && node.name.startsWith('Untitled spreadsheet')).at(-1)
    if (!created) await first.waitForTimeout(100)
  }
  assert.ok(created, 'a spreadsheet was created')
  assert.match(created.name, /\.xlsx$/)

  // Another, named for this run, gets values and a formula typed into it.
  const unique = randomUUID().slice(0, 8)
  const name = `Budget-${unique}.xlsx`
  const doc = await request('POST', '/api/files/docs', { parentId: null, name })
  assert.equal(doc.format, 'sheet')
  await openFile(first, doc.id)
  await typeRow(first, 'A1', ['Item', 'Amount'])
  await typeRow(first, 'A2', ['Rent', '1200'])
  await typeRow(first, 'A3', ['Food', '300'])
  await typeRow(first, 'A4', ['Total', '=SUM(B2:B3)'])
  await expectCell(first, 'B4', '=SUM(B2:B3)')
  // The status bar sums the selection, so the formula was calculated (300 + 1500).
  await go(first, 'B3:B4')
  await first.getByText('Sum: 1,800').waitFor()

  // A second tab sees the first tab's edits, and its own edit reaches the first.
  const second = watch(await context.newPage())
  await openFile(second, doc.id)
  await expectCell(second, 'A2', 'Rent')
  await typeRow(second, 'C1', ['Note'])
  await expectCell(first, 'C1', 'Note')
  await second.close()
  await first.bringToFront()

  // Undo in the first tab reverts only its own typing.
  await typeRow(first, 'D1', ['temp'])
  await expectCell(first, 'D1', 'temp')
  await first.getByRole('button', { name: 'Undo' }).click()
  await expectCell(first, 'D1', '')
  await expectCell(first, 'C1', 'Note')

  // Stored: a reload shows it all.
  await first.locator('[data-sync-state="synced"]').waitFor()
  await first.reload()
  await first.locator('.pulpo-sheet canvas').first().waitFor()
  await first.locator('[data-sync-state="synced"]').waitFor({ timeout: 15_000 })
  await expectCell(first, 'B4', '=SUM(B2:B3)')
  await expectCell(first, 'C1', 'Note')

  // Downloading gives a real workbook, with the formula and its calculated value.
  const downloaded = await download(first, name)
  const read = openpyxl(downloaded, [
    'book = openpyxl.load_workbook(path)',
    'values = openpyxl.load_workbook(path, data_only=True)',
    'sheet, cached = book.active, values.active',
    'print(json.dumps({"cells": [[cell.value for cell in row] for row in sheet.iter_rows(min_row=1, max_row=4, max_col=3)], "total": cached["B4"].value}))',
  ].join('\n'))
  assert.deepEqual(read.cells, [['Item', 'Amount', 'Note'], ['Rent', 1200, null], ['Food', 300, null], ['Total', '=SUM(B2:B3)', null]])
  assert.equal(read.total, 1500)
  // The server's export, which agents pull, holds the same.
  const exportedPath = join(scratch, 'exported.xlsx')
  writeFileSync(exportedPath, Buffer.from(await (await context.request.fetch(`${base}/api/files/${doc.id}/export`)).body()))
  assert.deepEqual(openpyxl(exportedPath, 'print(json.dumps(openpyxl.load_workbook(path).active["A3"].value))'), 'Food')

  // An agent chat, for pushes from openpyxl the way an agent makes them.
  const modelId = 'live-sheets-fixture'
  const { data: models = [] } = await request('GET', '/api/admin/models')
  if (!models.some((model) => model.id === modelId)) {
    const { data: providers } = await request('GET', '/api/admin/providers')
    const provider = providers.find((existing) => existing.name === 'Live sheets fixture')
      ?? await request('POST', '/api/admin/providers', { name: 'Live sheets fixture', baseUrl: 'https://example.com/v1', apiKey: 'test-only' })
    await request('POST', '/api/admin/models', {
      id: modelId, providerConnectionId: provider.id, upstreamModelId: 'fixture', name: 'Live Sheets Fixture',
      contextWindow: 32000, maxOutputTokens: 1000, compactionEnabled: false,
      inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0,
    })
  }
  const agentChat = async (title, said) => {
    const chatId = randomUUID()
    const responseId = randomUUID()
    const now = new Date().toISOString()
    await request('POST', '/api/chats/import', {
      source: 'pulpo',
      data: {
        chats: [{ id: chatId, title, modelId, activeResponseId: responseId, createdAt: now, updatedAt: now }],
        responses: [{
          id: responseId, chatId, modelId, status: 'completed', createdAt: now, completedAt: now,
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Update the budget.' }] }],
          output: [{ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: said, annotations: [] }] }],
        }],
      },
    })
    const chats = await request('GET', '/api/chats')
    const chat = (chats.data ?? chats.chats ?? chats).find((item) => item.title === title)
    assert.ok(chat, 'the imported chat is listed')
    const detail = await request('GET', `/api/chats/${chat.id}`)
    const reply = (detail.responses ?? detail.data?.responses ?? []).at(-1)?.id ?? detail.activeResponseId ?? detail.chat?.activeResponseId
    assert.ok(reply, 'the imported reply has an id')
    return { chatId: chat.id, reply }
  }
  const seed = (chat, file, mode) =>
    execFileSync('npx', ['tsx', 'scripts/seed-live-suggestion.ts', chat.chatId, chat.reply, doc.id, file, mode], { cwd: serverRoot, env: process.env, stdio: 'inherit' })

  // The agent inserts a row at the top with openpyxl and pushes, while the user, offline, edits a
  // cell below. Once back online, the user's edit has moved down with its row.
  const agentFile = join(scratch, 'agent.xlsx')
  const pulled = await download(first)
  openpyxl(pulled, [
    'book = openpyxl.load_workbook(path)',
    'sheet = book.active',
    'sheet.insert_rows(1)',
    'sheet["A1"] = "Budget"',
    'book.save(sys.argv[2])',
    'print("null")',
  ].join('\n'), agentFile)
  await context.setOffline(true)
  await typeRow(first, 'A3', ['Groceries'])
  seed(await agentChat(`Insert a title in ${name}`, 'I added a title row.'), agentFile, 'write')
  await context.setOffline(false)
  await first.locator('[data-sync-state="synced"]').waitFor({ timeout: 30_000 })
  await expectCell(first, 'A1', 'Budget')
  await expectCell(first, 'A2', 'Item')
  await expectCell(first, 'A4', 'Groceries')
  await expectCell(first, 'B4', '300')

  // The agent suggests a change; the reply's change list shows the cells it changes, and
  // accepting it changes the spreadsheet.
  const suggestion = join(scratch, 'suggestion.xlsx')
  openpyxl(await download(first), [
    'book = openpyxl.load_workbook(path)',
    'book.active["B4"] = 350',
    'book.save(sys.argv[2])',
    'print("null")',
  ].join('\n'), suggestion)
  const chat = await agentChat(`Raise food in ${name}`, 'I suggested a bigger food budget.')
  seed(chat, suggestion, 'suggest')
  await first.goto(`${base}/c/${chat.chatId}`)
  await first.getByRole('button', { name: `Show the changes to ${name}` }).click()
  const dialog = first.getByRole('dialog', { name: `Changes to ${name}` })
  await dialog.getByRole('rowheader', { name: 'B4' }).waitFor({ timeout: 15_000 })
  await dialog.getByText('350', { exact: true }).waitFor()
  if (screenshots) await first.screenshot({ path: join(screenshots, 'sheet-suggestion-diff-light.png') })
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await first.getByRole('button', { name: `Accept the change to ${name}` }).click()
  await first.getByText('accepted').waitFor()
  await openFile(first, doc.id)
  await expectCell(first, 'B4', '350')
  await expectCell(first, 'A4', 'Groceries')

  // An uploaded workbook (styles, merged cells, charts, three sheets) opens, becomes editable with
  // Edit, and downloads with everything openpyxl sees intact.
  const demo = readFileSync(new URL('./sheets/fixtures/demo.xlsx', import.meta.url))
  const reservation = await request('POST', '/api/files/uploads', { parentId: null, name: `demo-${unique}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: demo.byteLength })
  const put = await context.request.fetch(new URL(reservation.uploadUrl, base).toString(), { method: 'PUT', data: demo, headers: { ...reservation.uploadHeaders, origin: base } })
  assert.ok(put.ok(), `upload: ${put.status()} ${await put.text()}`)
  await request('POST', `/api/files/${reservation.node.id}/confirm`)
  await first.goto(`${base}/files/d/${reservation.node.id}`)
  await first.getByRole('button', { name: 'Edit' }).click()
  await first.locator('.pulpo-sheet canvas').first().waitFor()
  await first.locator('[data-sync-state="synced"]').waitFor({ timeout: 15_000 })
  await expectCell(first, 'A1', 'Quarterly budget')
  await first.getByRole('tab', { name: 'Trend' }).waitFor()
  const demoPath = join(scratch, 'demo-original.xlsx')
  writeFileSync(demoPath, demo)
  const summary = 'book = openpyxl.load_workbook(path)\nprint(json.dumps({"sheets": book.sheetnames, "charts": [len(sheet._charts) for sheet in book.worksheets], "merged": [str(r) for r in book["Budget"].merged_cells.ranges], "a1": book["Budget"]["A1"].font.b}))'
  assert.deepEqual(openpyxl(await download(first, `demo-${unique}.xlsx`), summary), openpyxl(demoPath, summary))
  if (screenshots) {
    await go(first, 'H2')
    await first.waitForTimeout(600)
    await first.screenshot({ path: join(screenshots, 'sheet-editor-light.png') })
    await first.evaluate(() => document.documentElement.classList.add('dark'))
    await first.waitForTimeout(600)
    await first.screenshot({ path: join(screenshots, 'sheet-editor-dark.png') })
    await first.evaluate(() => document.documentElement.classList.remove('dark'))
  }

  assert.deepEqual(errors, [])
  console.log('live sheets: ok')
} finally {
  await browser?.close()
  await server?.close()
}
