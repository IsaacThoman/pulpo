import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

// Converts a legacy Word file in Files on a running local stack whose server has
// OFFICE_CONVERTER_URL set (see infra/office-converter/README.md), then opens the result.
// PULPO_OFFICE_URL is the web app (default http://localhost:5173); PULPO_OFFICE_ACCOUNT is
// {"email":"...","password":"..."} for an approved account. PULPO_OFFICE_SCREENSHOTS, if set,
// is a directory for screenshots (nothing is written otherwise).
const base = new URL(process.env.PULPO_OFFICE_URL ?? 'http://localhost:5173')
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a local test stack')
const account = JSON.parse(process.env.PULPO_OFFICE_ACCOUNT ?? 'null')
assert(account?.email && account?.password, 'Supply PULPO_OFFICE_ACCOUNT')
const screenshots = process.env.PULPO_OFFICE_SCREENSHOTS
if (screenshots) await mkdir(screenshots, { recursive: true })
const fixtures = new URL('../../../packages/office-converter/fixtures/', import.meta.url).pathname
const run = Date.now().toString(36)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await context.newPage()
const serverErrors = []
page.on('response', (response) => {
  if (response.url().includes('/api/') && response.status() >= 500) serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`)
})
const shot = async (name) => { if (screenshots) await page.screenshot({ path: join(screenshots, `${name}.png`) }) }

async function listing(parentId) {
  return page.evaluate(async (id) => (await (await fetch(`/api/files${id ? `?parentId=${id}` : ''}`)).json()).children, parentId)
}

try {
  await page.goto(new URL('/login', base).href)
  await page.locator('#email').fill(account.email)
  await page.locator('#password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  // A folder of its own keeps runs apart.
  const folder = await page.evaluate(async (name) => {
    const response = await fetch('/api/files/folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentId: null, name }) })
    return (await response.json()).id
  }, `Office conversion ${run}`)
  await page.goto(new URL(`/files/f/${folder}`, base).href)
  // Upload through the folder's own New menu, as a user would.
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Upload files' }).click()
  await (await chooser).setFiles([join(fixtures, 'SampleDoc.doc'), join(fixtures, 'password_tika_binaryrc4.doc')])
  let uploaded = []
  for (let attempt = 0; attempt < 60 && uploaded.filter((item) => item.status === 'ready').length < 2; attempt += 1) {
    await page.waitForTimeout(500)
    uploaded = await listing(folder)
  }
  const legacy = uploaded.find((item) => item.name === 'SampleDoc.doc')
  assert(legacy, 'The .doc file was uploaded')

  // The legacy file opens read only, previewed as PDF, and explains converting.
  await page.goto(new URL(`/files/d/${legacy.id}`, base).href)
  await page.getByText(".doc files open read only. Converting makes a .docx copy beside it; the original stays as it is.").waitFor()
  await page.locator(`iframe[title="SampleDoc.doc"]`).waitFor({ timeout: 60_000 })
  await shot('legacy-file-view')

  await page.getByRole('button', { name: 'Convert to .docx' }).click()
  await page.getByRole('button', { name: 'Converting…' }).waitFor()
  const toast = page.getByRole('status').filter({ hasText: 'Converted to “SampleDoc.docx”' })
  await toast.waitFor({ timeout: 60_000 })
  await shot('converted-toast')
  await toast.getByRole('button', { name: 'Open' }).click()
  await page.waitForURL((url) => url.pathname.startsWith('/files/d/') && !url.pathname.endsWith(legacy.id))
  await page.waitForFunction(() => document.querySelector('input[aria-label="Document name"]')?.value === 'SampleDoc.docx')
  assert.equal(await page.getByRole('button', { name: 'Convert to .docx' }).count(), 0, 'A .docx file is not offered conversion again')
  await page.getByRole('button', { name: 'Download as PDF' }).waitFor()

  const after = await listing(folder)
  const converted = after.find((item) => item.name === 'SampleDoc.docx')
  assert(converted && converted.kind === 'blob' && converted.sizeBytes > 1_000, 'The converted file is beside the original')
  assert(after.some((item) => item.name === 'SampleDoc.doc'), 'The original is kept')
  const bytes = await page.evaluate(async (id) => {
    const { url } = await (await fetch(`/api/files/${id}/download`)).json()
    return [...new Uint8Array(await (await fetch(url)).arrayBuffer()).subarray(0, 2)]
  }, converted.id)
  assert.deepEqual(bytes, [0x50, 0x4b], 'The converted file is an Office Open XML package')

  // From the Files menu: Download as PDF, and a password-protected file's error.
  await page.goto(new URL(`/files/f/${folder}`, base).href)
  const main = page.locator('main')
  await main.getByText('SampleDoc.doc', { exact: true }).click({ button: 'right' })
  await shot('context-menu')
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('menuitem', { name: 'Download as PDF' }).click()
  const file = await download
  assert.equal(file.suggestedFilename(), 'SampleDoc.pdf')
  const stream = await file.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).subarray(0, 5).toString('latin1'), '%PDF-')

  await main.getByText('password_tika_binaryrc4.doc', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Convert to .docx' }).click()
  await page.getByRole('alert').filter({ hasText: "Password-protected files can't be converted" }).waitFor({ timeout: 60_000 })
  await shot('encrypted-error')
  assert(!(await listing(folder)).some((item) => item.name === 'password_tika_binaryrc4.docx'), 'Nothing is created for a file that fails')

  assert.deepEqual(serverErrors, [])
  console.log('Office conversion browser test passed.')
} finally {
  await browser.close()
}
