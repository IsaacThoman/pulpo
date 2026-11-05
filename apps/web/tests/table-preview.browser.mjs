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
  // The whole file is indexed up front, so the count is known before scrolling.
  await table.locator('[data-grid-summary]').getByText('5,001 rows · 20 columns').waitFor()
  assert.equal(await table.locator('[data-header-row] th').nth(1).textContent(), 'id', 'first header after the row numbers')
  // Columns past the viewport render as one spacer until scrolled to.
  const headerCells = await table.locator('[data-header-row] th').count()
  assert.ok(headerCells <= 22, `columns are windowed (${headerCells} header cells)`)
  await table.locator('[data-virtuoso-scroller="true"]').evaluate((element) => { element.scrollLeft = element.scrollWidth })
  await table.locator('[data-header-row] th', { hasText: /^metric_17$/ }).waitFor()
  await table.locator('[data-virtuoso-scroller="true"]').evaluate((element) => { element.scrollLeft = 0 })
  await table.locator('[data-header-row] th', { hasText: /^note$/ }).waitFor()
  // Only the visible slice is in the DOM.
  assert.ok(await table.locator('tbody tr').count() < 100, 'rows are virtualized')
  const firstNote = table.locator('tbody tr').first().locator('td').nth(3)
  assert.equal(await firstNote.textContent(), 'Note, with a comma 1')
  // Cells stay on one line like a spreadsheet, so every row has the same height.
  assert.ok((await firstNote.boundingBox()).height < 40, 'cells do not wrap')

  const scroller = table.locator('[data-virtuoso-scroller="true"]')
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await table.locator('tbody tr').last().getByText('5000', { exact: true }).first().waitFor()
  // The header stays pinned while scrolled to the bottom.
  const [headerTop, scrollerTop] = await Promise.all([
    table.locator('thead').evaluate((element) => element.getBoundingClientRect().top),
    scroller.evaluate((element) => element.getBoundingClientRect().top),
  ])
  assert.ok(Math.abs(headerTop - scrollerTop) < 1, 'header stays sticky')
  assert.deepEqual(errors, [])
  console.log('table preview shows the whole file as a virtualized grid')
} finally {
  await browser?.close()
  await server?.close()
}
