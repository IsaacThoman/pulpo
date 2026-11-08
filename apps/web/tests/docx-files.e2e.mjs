// End to end against a running Pulpo (web + API + worker), opt-in:
//   PULPO_E2E_URL=http://127.0.0.1:5173 PULPO_E2E_EMAIL=... PULPO_E2E_PASSWORD=... \
//   PULPO_DOCX_PYTHON=/tmp/pulpo-docx-venv/bin/python npm run test:docx-files -w @pulpo/web
// Creates a Word document from the New menu, edits it, collaborates across two tabs, reloads,
// downloads it and checks the bytes with python-docx, then uploads a Word file and edits it.
// SCREENSHOT_DIR also saves screenshots of the document page (light and dark).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.PULPO_E2E_URL
const email = process.env.PULPO_E2E_EMAIL
const password = process.env.PULPO_E2E_PASSWORD
const python = process.env.PULPO_DOCX_PYTHON ?? '/tmp/pulpo-docx-venv/bin/python'
const screenshots = process.env.SCREENSHOT_DIR
const fixture = new URL('../../../packages/client-core/fixtures/docx/tables.docx', import.meta.url)
assert.ok(base && email && password, 'Set PULPO_E2E_URL, PULPO_E2E_EMAIL, and PULPO_E2E_PASSWORD')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const work = mkdtempSync(join(tmpdir(), 'pulpo-docx-e2e-'))
const stamp = Date.now().toString(36)

function pythonDocx(file, script) {
  const result = spawnSync(python, ['-I', '-c', script, file], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

const browser = await chromium.launch()
const results = []
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true })
  const login = await context.request.post(`${base}/api/auth/login`, { data: { email, password } })
  assert.equal(login.status(), 200, await login.text())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const flow = (target) => target.locator('.docx-flow.ProseMirror').first()

  // Create from the New menu, in a folder of its own so names do not collide between runs.
  const folder = await context.request.post(`${base}/api/files/folders`, { data: { parentId: null, name: `Word e2e ${stamp}` } })
  assert.equal(folder.status(), 201, await folder.text())
  const created = await folder.json()
  const folderId = created.node?.id ?? created.id
  await page.goto(`${base}/files/f/${folderId}`)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New Word document' }).click()
  // A new document opens in the editor, its name selected in the title (without the extension).
  await page.waitForURL(/\/files\/d\//)
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Document name')
  await page.keyboard.type('Launch plan')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('input[aria-label="Document name"]')?.value === 'Launch plan.docx')
  const url = page.url()
  await flow(page).waitFor()
  await page.locator('[data-docx-page], .docx-page').first().waitFor()
  results.push('creates a document from the New menu')

  // Edit: a heading, bold text, and a list.
  await flow(page).locator('p').first().click()
  await page.getByRole('button', { name: 'Style' }).click()
  await page.getByRole('menuitem', { name: 'Heading 1', exact: true }).click()
  await page.keyboard.type('Launch plan')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ship it ')
  await page.keyboard.press(`${mod}+b`)
  await page.keyboard.type('carefully')
  await page.keyboard.press(`${mod}+b`)
  await page.keyboard.type('.')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Bulleted list' }).click()
  await page.keyboard.type('Write the docs')
  await flow(page).locator('p[data-label]', { hasText: 'Write the docs' }).waitFor()
  results.push('edits with styles, bold, and lists')

  // A second tab edits the same document; each sees the other.
  const second = await context.newPage()
  await second.goto(url)
  await flow(second).locator('p', { hasText: 'Ship it carefully.' }).waitFor({ timeout: 20_000 })
  await flow(second).locator('p', { hasText: 'Launch plan' }).click()
  await second.keyboard.press(`${mod}+ArrowRight`).catch(() => {})
  await second.keyboard.press('End')
  await second.keyboard.type(' 2026')
  await flow(page).locator('p', { hasText: 'Launch plan 2026' }).waitFor({ timeout: 20_000 })
  await flow(page).locator('.ProseMirror-yjs-cursor').first().waitFor({ timeout: 20_000 })
  results.push('two tabs edit together with live cursors')

  // Reload: everything was saved.
  await page.waitForTimeout(1500)
  await page.reload()
  await flow(page).locator('p', { hasText: 'Launch plan 2026' }).waitFor({ timeout: 20_000 })
  await flow(page).locator('p', { hasText: 'Ship it carefully.' }).waitFor()
  results.push('keeps edits across a reload')
  if (screenshots) await page.screenshot({ path: join(screenshots, 'docx-files-light.png') })

  // Download and read the bytes with python-docx.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const file = join(work, 'download.docx')
  await (await download).saveAs(file)
  const read = pythonDocx(file, `
import sys, docx
d = docx.Document(sys.argv[1])
ps = d.paragraphs
assert ps[0].text == 'Launch plan 2026' and ps[0].style.name == 'Heading 1', (ps[0].text, ps[0].style.name)
runs = [(r.text, r.bold) for r in ps[1].runs]
assert ('carefully', True) in runs, runs
assert ps[2].text == 'Write the docs' and ps[2]._p.pPr.numPr is not None
print('ok')
`)
  assert.equal(read, 'ok')
  results.push('downloads a .docx python-docx reads as written')

  // Upload a Word file and edit it: Word files convert to live documents on Edit.
  const bytes = readFileSync(fixture)
  const reserve = await context.request.post(`${base}/api/files/uploads`, { data: { parentId: folderId, name: 'Tables.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: bytes.byteLength } })
  assert.equal(reserve.status(), 201, await reserve.text())
  const reservation = await reserve.json()
  const put = await context.request.put(new URL(reservation.uploadUrl, base).toString(), { data: bytes, headers: reservation.uploadHeaders })
  assert.ok(put.ok(), await put.text())
  const confirmed = await context.request.post(`${base}/api/files/${reservation.node.id}/confirm`, { data: {} })
  assert.ok(confirmed.ok(), await confirmed.text())
  await page.goto(`${base}/files/d/${reservation.node.id}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await flow(page).locator('td', { hasText: 'Grid 1,3' }).waitFor({ timeout: 30_000 })
  await flow(page).locator('td', { hasText: 'Grid 1,3' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' (edited)')
  await page.waitForTimeout(1500)
  const exported = await context.request.get(`${base}/api/files/${reservation.node.id}/export`)
  assert.ok(exported.ok(), await exported.text())
  writeFileSync(join(work, 'tables.docx'), await exported.body())
  assert.equal(pythonDocx(join(work, 'tables.docx'), `
import sys, docx
cells = [c.text for t in docx.Document(sys.argv[1]).tables for r in t.rows for c in r.cells]
assert any('Grid 1,3 (edited)' in c for c in cells), cells[:12]
print('ok')
`), 'ok')
  results.push('edits an uploaded Word file and exports it')

  if (screenshots) {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: join(screenshots, 'docx-files-dark.png') })
  }
  assert.deepEqual(errors, [])
  console.log(`docx in Files:\n${results.map((line) => `  ✓ ${line}`).join('\n')}`)
} finally {
  await browser.close()
}
