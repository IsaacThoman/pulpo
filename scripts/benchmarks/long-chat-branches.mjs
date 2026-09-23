import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

// Exercises the public edit/activation APIs in the disposable benchmark database.
const out = process.env.BENCH_OUTPUT ?? '/tmp/pulpo-longchat-after'
const fixture = JSON.parse(await readFile(`${out}/fixtures.json`, 'utf8'))
const c = fixture.cases.find(c => c.kind === 'plain' && c.turns === 5000)
const headers = { cookie: `pulpo_session=${fixture.token}`, 'content-type': 'application/json' }
async function request(path, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:3319${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  assert(response.ok, `${path}: ${response.status} ${await response.clone().text()}`)
  return response.status === 204 ? null : response.json()
}
const proxy = Object.fromEntries(['/api', '/health', '/socket.io'].map(path => [path, { target: 'http://127.0.0.1:3319', ws: path === '/socket.io' }]))
const server = await preview({ root: new URL('../../apps/web', import.meta.url).pathname, configFile: false, preview: { host: '127.0.0.1', port: 4319, strictPort: true, proxy } })
const browser = await chromium.launch()
let alternateId
try {
  const edit = await request(`/api/messages/${c.lastResponseId}`, { content: 'Alternative branch for the long-chat regression check.\n\n```html\n<!doctype html><html><body><h1>Preview fixture</h1></body></html>\n```' }, 'PATCH')
  alternateId = edit.response.responseId
  await request(`/api/messages/${c.lastResponseId}/activate?historyLimit=500`)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addCookies([{ name: 'pulpo_session', value: fixture.token, url: 'http://127.0.0.1:4319', httpOnly: true, sameSite: 'Lax' }])
  const page = await context.newPage()
  const errors = [], activations = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('response', async response => {
    if (response.url().includes('/activate') && response.ok()) {
      const body = await response.json()
      activations.push({ turns: body.responses.length, leafId: body.activeBranchLeafId, offset: body.history.offset })
    }
  })
  await page.goto(`http://127.0.0.1:4319/c/${c.id}`)
  const original = page.locator(`[data-message-id="${c.lastResponseId}"]`)
  await original.filter({ hasText: 'END-5000' }).waitFor()
  await page.waitForTimeout(1200)
  await page.locator('textarea').last().fill('Keep this draft through branch changes')
  await original.getByRole('button', { name: 'Next branch' }).click()
  const alternate = page.locator(`[data-message-id="${alternateId}"]`)
  await alternate.filter({ hasText: 'Alternative branch' }).waitFor()
  assert.equal(await original.count(), 0, 'Old branch must disappear')
  await alternate.getByRole('button', { name: 'Preview', exact: true }).click()
  await page.getByRole('complementary', { name: 'Code preview' }).waitFor()
  await page.waitForTimeout(500)
  const previewGap = await page.locator('[data-radix-scroll-area-viewport]').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
  assert(previewGap <= 4, `Opening the preview panel moved the bottom: ${previewGap}`)
  await page.getByRole('button', { name: 'Close preview' }).click()
  await page.waitForTimeout(300)
  await alternate.getByRole('button', { name: 'Edit response', exact: true }).click()
  await alternate.getByRole('textbox').fill('Unsaved assistant edit survives virtualization')
  await page.mouse.move(950, 300)
  await page.mouse.wheel(0, -50000)
  await page.waitForTimeout(500)
  assert.equal(await alternate.count(), 0, `Edited row really unmounts outside overscan: ${JSON.stringify(await page.locator('[data-radix-scroll-area-viewport]').evaluate(el => ({ top: el.scrollTop, height: el.scrollHeight, active: document.activeElement?.tagName })))}`)
  await page.locator('[data-radix-scroll-area-viewport]').evaluate(el => { el.scrollTop = el.scrollHeight })
  await alternate.getByRole('textbox').waitFor()
  assert.equal(await alternate.getByRole('textbox').inputValue(), 'Unsaved assistant edit survives virtualization')
  await alternate.getByRole('button', { name: 'Cancel', exact: true }).click()
  await alternate.getByRole('button', { name: 'Previous branch' }).click()
  await original.filter({ hasText: 'END-5000' }).waitFor()
  assert.equal(await alternate.count(), 0)
  await page.waitForTimeout(500)
  const gap = await page.locator('[data-radix-scroll-area-viewport]').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
  assert(gap <= 4, `Branch replacement left a bottom gap: ${gap}`)
  assert.equal(await page.locator('textarea').last().inputValue(), 'Keep this draft through branch changes')
  assert.equal(activations.length, 2)
  assert(activations.every(result => result.turns === 500 && result.offset === 4500))
  assert.deepEqual(errors, [])
  const result = { activations, bottomGap: gap, draftPreserved: true, previewPanelValidated: true, inlineEditPreserved: true, errors }
  await writeFile(`${out}/branches.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await request(`/api/messages/${c.lastResponseId}/activate?historyLimit=500`)
  if (alternateId) await request(`/api/messages/${alternateId}`, undefined, 'DELETE')
  await browser.close()
  await new Promise(r => server.httpServer.close(r))
}
