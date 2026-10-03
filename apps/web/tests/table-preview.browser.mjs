// Run with: npm run test:table-preview -w @pulpo/web
// Install the browser once with: npx playwright install chromium
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
let server
let browser
try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${server.resolvedUrls.local[0]}tests/table-preview/index.html?rows=5000`)

  const table = page.locator('[data-preview-kind="table"]')
  const status = table.getByRole('status')
  await status.getByText('200 rows loaded · 20 columns · scroll for more').waitFor()
  assert.equal(await table.locator('thead th').count(), 21, 'row number column plus every header')
  // Only the visible slice is in the DOM.
  assert.ok(await table.locator('tbody tr').count() < 100, 'rows are virtualized')
  const firstNote = table.locator('tbody tr').first().locator('td').nth(3)
  assert.equal(await firstNote.textContent(), 'Note, with a comma 1')
  // Cells stay on one line like a spreadsheet, so every row has the same height.
  assert.ok((await firstNote.boundingBox()).height < 40, 'cells do not wrap')

  const scroller = table.locator('[data-virtuoso-scroller="true"]')
  const scrollToEnd = () => scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await scrollToEnd()
  await status.getByText('400 rows loaded · 20 columns · scroll for more').waitFor()

  // Keep scrolling until the whole file has streamed in.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await status.getByText('5,000 rows · 20 columns').isVisible()) break
    await scrollToEnd()
    await page.waitForTimeout(50)
  }
  await status.getByText('5,000 rows · 20 columns').waitFor({ timeout: 1000 })
  await scrollToEnd()
  await table.locator('tbody tr').last().getByText('5000', { exact: true }).first().waitFor()
  // The header stays pinned while scrolled to the bottom.
  const [headerTop, scrollerTop] = await Promise.all([
    table.locator('thead').evaluate((element) => element.getBoundingClientRect().top),
    scroller.evaluate((element) => element.getBoundingClientRect().top),
  ])
  assert.ok(Math.abs(headerTop - scrollerTop) < 1, 'header stays sticky')
  assert.deepEqual(errors, [])
  console.log('table preview streams rows while scrolling')
} finally {
  await browser?.close()
  await server?.close()
}
