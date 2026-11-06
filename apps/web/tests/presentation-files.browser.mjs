// End-to-end test of PowerPoint decks in Files, against a running Pulpo API and its database
// (local and disposable: it creates an account, files, and chats):
//   PULPO_API_URL=http://127.0.0.1:3000 DATABASE_URL=postgres://… npm run test:presentation-files -w @pulpo/web
// Optional: PULPO_PPTX_PYTHON (a Python with python-pptx) checks downloads with python-pptx;
// PULPO_SCREENSHOTS=<dir> saves screenshots of the editor and the review dialog.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const api = process.env.PULPO_API_URL ?? 'http://127.0.0.1:3000'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) throw new Error('Run against a local, disposable API only.')
const screenshots = process.env.PULPO_SCREENSHOTS
const python = process.env.PULPO_PPTX_PYTHON ?? '/tmp/pulpo-pptx-venv/bin/python'
const root = new URL('..', import.meta.url).pathname
const serverRoot = new URL('../../server', import.meta.url).pathname
const fixtures = new URL('../../../packages/client-core/fixtures/presentation/', import.meta.url).pathname
const account = { name: 'Deck Tester', username: 'deck_tester', email: 'deck-tester@example.test', password: 'Deck-tester-2026' }
const scratch = mkdtempSync(join(tmpdir(), 'pulpo-presentation-files-'))
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** The text python-pptx reads from a deck, slide by slide. */
function pythonText(file) {
  if (!existsSync(python)) return undefined
  return execFileSync(python, ['-I', '-c', 'import sys\nfrom pptx import Presentation\nfor s in Presentation(sys.argv[1]).slides:\n    print("|".join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame))', file], { encoding: 'utf8' })
}

/** Replaces the first text run of a slide, as an agent's python-pptx edit would. */
function editSlide(bytes, slide, text) {
  const parts = unzipSync(new Uint8Array(bytes))
  const path = `ppt/slides/slide${slide}.xml`
  parts[path] = strToU8(strFromU8(parts[path]).replace(/<a:t>[^<]*<\/a:t>/, `<a:t>${text}</a:t>`))
  return Buffer.from(zipSync(parts))
}

let server
let browser
try {
  server = await createServer({
    root,
    logLevel: 'error',
    // Keep the browser's Host header: the API accepts writes from the origin they are addressed to.
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: api, changeOrigin: false }, '/health': { target: api, changeOrigin: false }, '/socket.io': { target: api.replace(/^http/, 'ws'), ws: true } } },
  })
  await server.listen()
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })
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
  const slideShapes = (page) => page.locator('.pp-canvas .pp-canvas-slide .pp-slide > [data-key]')
  const openDeck = async (page, id) => {
    await page.goto(`${base}/files/d/${id}`)
    await page.locator('.pp-canvas .pp-slide').first().waitFor({ timeout: 20_000 })
    await page.getByText('Synced').waitFor({ timeout: 15_000 })
  }
  const deckText = (page) => page.evaluate(() => [...document.querySelectorAll('.pp-thumbs .pp-thumb')].length)
  const exportOf = async (id) => Buffer.from(await (await context.request.fetch(`${base}/api/files/${id}/export`)).body())
  const textOf = async (id) => {
    const file = join(scratch, `${randomUUID()}.pptx`)
    writeFileSync(file, await exportOf(id))
    return pythonText(file) ?? strFromU8(unzipSync(new Uint8Array(readFileSync(file)))['ppt/slides/slide1.xml'])
  }
  const unique = randomUUID().slice(0, 8)

  // The Files "New" menu makes a presentation, which opens in the editor.
  const first = watch(await context.newPage())
  await first.goto(`${base}/files`)
  await first.getByRole('button', { name: 'New', exact: true }).click()
  await first.getByRole('menuitem', { name: 'New presentation' }).click()
  // The new file is named in place; renaming selects the name without its extension.
  await first.waitForFunction(() => document.activeElement?.tagName === 'INPUT')
  await first.keyboard.type(`Pitch ${unique}`)
  await first.keyboard.press('Enter')
  await first.getByText(`Pitch ${unique}`).first().dblclick()
  await first.locator('.pp-canvas .pp-slide').first().waitFor({ timeout: 20_000 })
  const id = new URL(first.url()).pathname.split('/').pop()
  await first.getByText('Synced').waitFor({ timeout: 15_000 })
  assert.equal(await deckText(first), 1)

  // Type a title in the first tab.
  await slideShapes(first).first().dblclick()
  await first.locator('.pp-canvas .pp-text-editor').waitFor()
  await first.keyboard.type('Quarterly review')
  await first.keyboard.press('Escape')

  // A second tab sees it, adds a slide, and moves a shape; the first tab sees both.
  const second = watch(await context.newPage())
  await openDeck(second, id)
  await second.locator('.pp-canvas').getByText('Quarterly review').waitFor({ timeout: 15_000 })
  await second.getByRole('button', { name: 'New slide' }).click()
  await second.getByRole('menuitem', { name: 'Title and Content' }).click()
  await first.locator('.pp-thumbs .pp-thumb').nth(1).waitFor({ timeout: 15_000 })
  await second.locator('.pp-thumbs .pp-thumb').first().click()
  const subtitle = slideShapes(second).nth(1)
  await subtitle.click()
  const box = await subtitle.boundingBox()
  await second.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await second.mouse.down()
  await second.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 8 })
  await second.mouse.up()
  // The first tab shows the second tab's selection, named.
  await first.locator('.pp-remote').first().waitFor({ timeout: 15_000 })
  await second.close()
  await first.bringToFront()

  // Reloading shows what was stored.
  await first.waitForTimeout(500)
  await first.getByText('Synced').waitFor()
  await first.reload()
  await first.locator('.pp-canvas .pp-slide').first().waitFor({ timeout: 20_000 })
  await first.locator('.pp-canvas').getByText('Quarterly review').waitFor({ timeout: 15_000 })
  assert.equal(await deckText(first), 2)

  // Downloading gives a real .pptx that python-pptx reads.
  const [download] = await Promise.all([first.waitForEvent('download'), first.getByRole('button', { name: 'Download' }).click()])
  assert.equal(download.suggestedFilename(), `Pitch ${unique}.pptx`)
  const downloaded = await download.path()
  const read = pythonText(downloaded)
  if (read !== undefined) assert.match(read.split('\n')[0], /Quarterly review/)
  else assert.match(strFromU8(unzipSync(new Uint8Array(readFileSync(downloaded)))['ppt/slides/slide1.xml']), /Quarterly review/)
  if (screenshots) await first.screenshot({ path: join(screenshots, 'files-editor-light.png') })

  // An uploaded deck with pictures opens for editing directly and keeps its pictures.
  const original = readFileSync(join(fixtures, 'generated/pictures.pptx'))
  const reservation = await request('POST', '/api/files/uploads', { parentId: null, name: `Pictures ${unique}.pptx`, mimeType: PPTX, sizeBytes: original.byteLength })
  const put = await context.request.fetch(new URL(reservation.uploadUrl, base).toString(), { method: 'PUT', data: original, headers: { ...reservation.uploadHeaders, origin: base } })
  assert.ok(put.ok(), `upload: ${put.status()}`)
  await request('POST', `/api/files/${reservation.node.id}/confirm`)
  await first.goto(`${base}/files/d/${reservation.node.id}`)
  await first.getByRole('button', { name: 'Edit' }).click()
  await first.locator('.pp-canvas .pp-slide').first().waitFor({ timeout: 20_000 })
  await first.locator('.pp-canvas image[href^="blob:"]').first().waitFor({ state: 'attached', timeout: 20_000 })
  // Untouched, it exports byte for byte, part for part.
  const before = unzipSync(new Uint8Array(original))
  const after = unzipSync(new Uint8Array(await exportOf(reservation.node.id)))
  for (const [path, data] of Object.entries(before)) assert.ok(Buffer.from(after[path]).equals(Buffer.from(data)), `${path} unchanged`)

  // Agents: a chat whose replies push to the deck.
  const modelId = 'presentation-fixture'
  const { data: models = [] } = await request('GET', '/api/admin/models')
  if (!models.some((model) => model.id === modelId)) {
    const { data: providers } = await request('GET', '/api/admin/providers')
    const provider = providers.find((existing) => existing.name === 'Presentation fixture')
      ?? await request('POST', '/api/admin/providers', { name: 'Presentation fixture', baseUrl: 'https://example.com/v1', apiKey: 'test-only' })
    await request('POST', '/api/admin/models', {
      id: modelId, providerConnectionId: provider.id, upstreamModelId: 'fixture', name: 'Presentation Fixture',
      contextWindow: 32000, maxOutputTokens: 1000, compactionEnabled: false,
      inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0,
    })
  }
  const newChat = async (title) => {
    const chatId = randomUUID()
    const now = new Date().toISOString()
    await request('POST', '/api/chats/import', {
      source: 'pulpo',
      data: {
        chats: [{ id: chatId, title, modelId, activeResponseId: randomUUID(), createdAt: now, updatedAt: now }],
        responses: [{
          id: randomUUID(), chatId, modelId, status: 'completed', createdAt: now, completedAt: now,
          input: [{ role: 'user', content: [{ type: 'input_text', text: title }] }],
          output: [{ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }],
        }],
      },
    })
    const chats = await request('GET', '/api/chats')
    const chat = (chats.data ?? chats.chats ?? chats).find((item) => item.title === title)
    const detail = await request('GET', `/api/chats/${chat.id}`)
    const reply = (detail.responses ?? detail.data?.responses ?? []).at(-1)?.id ?? detail.activeResponseId ?? detail.chat?.activeResponseId
    return { chat: chat.id, reply }
  }
  const agentPush = (chat, reply, bytes, mode) => {
    const file = join(scratch, `${randomUUID()}.pptx`)
    writeFileSync(file, bytes)
    execFileSync('npx', ['tsx', 'scripts/seed-live-suggestion.ts', chat, reply, id, file, mode], { cwd: serverRoot, env: process.env, stdio: 'inherit' })
  }

  // An agent push in Edit mode lands while this tab's edit to another slide is still in flight
  // (the tab is offline): once it reconnects, both changes are there.
  await openDeck(first, id)
  const pulled = await exportOf(id)
  await first.locator('.pp-thumbs .pp-thumb').nth(1).click()
  await context.setOffline(true)
  await slideShapes(first).first().dblclick()
  await first.locator('.pp-canvas .pp-text-editor').waitFor()
  await first.keyboard.type('Agenda')
  await first.keyboard.press('Escape')
  const direct = await newChat(`Retitle ${unique}`)
  agentPush(direct.chat, direct.reply, editSlide(pulled, 1, 'Agent title'), 'write')
  await context.setOffline(false)
  await first.locator('.pp-thumbs .pp-thumb').first().getByText('Agent title').waitFor({ timeout: 30_000 })
  await first.waitForTimeout(500)
  await first.getByText('Synced').waitFor()
  const merged = await textOf(id)
  assert.match(merged, /Agent title/)
  assert.match(merged, /Agenda/)

  // An agent suggestion is reviewed as a slide diff and accepted.
  const suggestion = await newChat(`Suggest ${unique}`)
  agentPush(suggestion.chat, suggestion.reply, editSlide(await exportOf(id), 1, 'Suggested title'), 'suggest')
  await first.goto(`${base}/c/${suggestion.chat}`)
  await first.getByRole('button', { name: `Show the changes to Pitch ${unique}.pptx` }).click()
  const dialog = first.getByRole('dialog', { name: `Changes to Pitch ${unique}.pptx` })
  await dialog.locator('[data-presentation-diff] [data-status="edited"]').waitFor({ timeout: 20_000 })
  await dialog.getByText('Suggested title').first().waitFor()
  if (screenshots) await first.screenshot({ path: join(screenshots, 'files-suggestion-diff-light.png') })
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await first.getByRole('button', { name: `Accept the change to Pitch ${unique}.pptx` }).click()
  await first.getByText('accepted').waitFor()
  assert.match(await textOf(id), /Suggested title/)

  assert.deepEqual(errors, [])
  console.log('presentation files: ok')
} finally {
  await browser?.close()
  await server?.close()
}
