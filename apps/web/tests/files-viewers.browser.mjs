// Run with: npm run test:files-viewers -w @pulpo/web
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
  const base = `${server.resolvedUrls.local[0]}tests/files-viewers/index.html`
  browser = await chromium.launch()
  const errors = []
  const open = async (query) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('dialog', (dialog) => {
      errors.push(`unexpected dialog: ${dialog.message()}`)
      void dialog.dismiss()
    })
    await page.goto(`${base}?${query}`)
    return page
  }
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

  // --- CSV grid: 150k rows, virtualized, sticky header, find, resize, text mode.
  {
    const page = await open('viewer=grid&rows=150000')
    const grid = page.locator('[data-preview-kind="table"]')
    await grid.getByText('150,001 rows · 12 columns').waitFor({ timeout: 20_000 })
    assert.ok(await grid.locator('tbody tr').count() < 120, 'rows are virtualized')
    assert.equal(await grid.locator('thead tr').first().locator('th').nth(1).textContent(), 'A', 'column letters')
    assert.equal(await grid.locator('[data-header-row] th').nth(2).textContent(), 'customer', 'header row')

    const scroller = grid.locator('[data-virtuoso-scroller="true"]')
    const started = Date.now()
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await grid.locator('tbody td', { hasText: /^150,001$/ }).waitFor()
    assert.ok(Date.now() - started < 3_000, 'jumping to the last row is fast')
    const [headerTop, scrollerTop] = await Promise.all([
      grid.locator('thead').evaluate((element) => element.getBoundingClientRect().top),
      scroller.evaluate((element) => element.getBoundingClientRect().top),
    ])
    assert.ok(Math.abs(headerTop - scrollerTop) < 1, 'header stays sticky at the bottom')
    // Quoted line breaks and escaped quotes stay inside one cell.
    await scroller.evaluate((element) => { element.scrollTop = 0 })

    await grid.locator('tbody').click()
    await page.keyboard.press(`${modifier}+f`)
    const find = page.getByRole('search')
    await find.getByRole('textbox', { name: 'Find' }).fill('customer 75000')
    await find.getByText('1 of 1').waitFor()
    const hit = grid.locator('tbody td', { hasText: /^Customer 75000$/ })
    await hit.waitFor()
    assert.match(await hit.getAttribute('class'), /bg-amber/, 'the matching cell is highlighted')
    await find.getByRole('textbox', { name: 'Find' }).fill('line two, with "quotes"')
    await find.getByText('1 of 150').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('search').count(), 0, 'Escape closes find')

    const column = grid.locator('thead tr').first().locator('th').nth(2)
    const before = (await column.boundingBox()).width
    const handle = column.getByRole('separator')
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    const after = (await column.boundingBox()).width
    assert.ok(after > before + 80, `column resized (${before} → ${after})`)

    await page.getByRole('button', { name: 'Show as text' }).click()
    await page.locator('[data-preview-kind="code"]').getByText('id,customer,note,metric_1').waitFor()
    await page.close()
  }

  // --- A wide CSV renders only the columns in view.
  {
    const page = await open('viewer=grid&rows=200&columns=400')
    const grid = page.locator('[data-preview-kind="table"]')
    await grid.getByText('201 rows · 400 columns').waitFor()
    const rendered = await grid.locator('[data-header-row] th').count()
    assert.ok(rendered < 120, `columns are virtualized (${rendered} rendered)`)
    const scroller = grid.locator('[data-virtuoso-scroller="true"]')
    // Find scrolls sideways to a match in a column that isn't rendered yet, and back again.
    await grid.locator('tbody').click()
    await page.keyboard.press(`${modifier}+f`)
    const find = page.getByRole('search')
    await find.getByRole('textbox', { name: 'Find' }).fill('metric_397')
    await grid.locator('[data-header-row] th', { hasText: /^metric_397$/ }).waitFor()
    await find.getByRole('textbox', { name: 'Find' }).fill('Customer 150')
    await grid.locator('td', { hasText: /^Customer 150$/ }).waitFor()
    assert.ok(await scroller.evaluate((element) => element.scrollLeft) < 400, 'find scrolls back to the left')
    await page.keyboard.press('Escape')
    await scroller.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    await grid.locator('thead th', { hasText: /^OJ$/ }).waitFor()
    await page.close()
  }

  // --- Code: highlighting, line numbers, wrap, find, and a large file.
  {
    const page = await open('viewer=code&lines=40')
    const code = page.locator('[data-preview-kind="code"]')
    await code.locator('.hljs-keyword').first().waitFor()
    assert.ok(await code.locator('.hljs-comment').count() > 0, 'comments are highlighted')
    // The opening block comment spans two lines; its second line is still a comment.
    assert.equal(await code.locator('[data-line="2"] .hljs-comment').count(), 1, 'multi-line tokens survive line splitting')
    const wrap = page.getByRole('button', { name: 'Wrap lines' })
    assert.equal(await wrap.getAttribute('aria-pressed'), 'false')
    await wrap.click()
    assert.equal(await wrap.getAttribute('aria-pressed'), 'true')
    assert.match(await code.locator('[data-line="1"] > span').nth(1).getAttribute('class'), /whitespace-pre-wrap/)
    await code.click()
    await page.keyboard.press(`${modifier}+f`)
    await page.getByRole('textbox', { name: 'Find' }).fill('doubles line 3')
    await page.getByRole('search').getByText('1 of 11').waitFor()
    assert.equal(await code.locator('mark.find-match-current').textContent(), 'Doubles line 3')
    await page.keyboard.press('Enter')
    await page.getByRole('search').getByText('2 of 11').waitFor()
    await page.close()
  }
  {
    const page = await open('viewer=code&lines=60000')
    const code = page.locator('[data-preview-kind="code"]')
    await code.getByText('Syntax highlighting is off for files this large.').waitFor({ timeout: 20_000 })
    const scroller = code.locator('[data-virtuoso-scroller="true"]')
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await code.locator('[data-line="300000"]').waitFor()
    assert.ok(await code.locator('[data-line]').count() < 200, 'lines are virtualized')
    await page.close()
  }

  // --- HTML: rendered only in the opaque-origin sandbox, which cannot reach the app.
  {
    const page = await open('viewer=html')
    const frameElement = page.locator('iframe[data-testid="sandbox-frame"]')
    await frameElement.waitFor()
    const sandbox = await frameElement.getAttribute('sandbox')
    assert.ok(!sandbox.includes('allow-same-origin'), 'no allow-same-origin')
    const frame = page.frameLocator('iframe[data-testid="sandbox-frame"]')
    const probe = frame.locator('#probe')
    await probe.filter({ hasText: 'origin=' }).waitFor()
    const report = await probe.textContent()
    assert.match(report, /^origin=null$/m)
    assert.match(report, /^cookie=blocked$/m)
    assert.match(report, /^parent=blocked$/m)
    assert.match(report, /^storage=blocked$/m)
    assert.doesNotMatch(report, /parent-only/)
    await page.getByRole('button', { name: 'Show source' }).click()
    await page.locator('[data-preview-kind="code"] .hljs-tag').first().waitFor()
    await page.close()
  }

  // --- Notebook: Markdown with math and attachments, code cells, every output type.
  for (const theme of ['light', 'dark']) {
    const page = await open(`viewer=notebook&theme=${theme}`)
    const notebook = page.locator('[data-preview-kind="notebook"]')
    await notebook.getByRole('heading', { name: 'Quarterly report' }).waitFor()
    assert.ok(await notebook.locator('.katex').count() > 0, 'math renders')
    assert.match(await notebook.locator('[data-cell="markdown"] img').getAttribute('src'), /^data:image\/png;base64,/, 'cell attachments resolve')
    await notebook.getByText('[7]:').first().waitFor()
    assert.ok(await notebook.locator('[data-cell="code"] .hljs-keyword').count() > 0, 'code cells are highlighted')
    await notebook.locator('[data-output="stream"]', { hasText: '3.141592653589793' }).waitFor()
    assert.match(await notebook.locator('[data-output="image"]').getAttribute('src'), /^data:image\/png;base64,/)
    const traceback = notebook.locator('[data-output="error"]')
    assert.equal(await traceback.locator('.ansi-fg-red').textContent(), 'ZeroDivisionError')
    assert.equal(await traceback.locator('img').count(), 0, 'tracebacks are text, never markup')
    const output = page.frameLocator('[data-output="html"] iframe')
    await output.locator('table.dataframe').waitFor()
    await output.locator('#probe').filter({ hasText: 'origin=' }).waitFor()
    assert.match(await output.locator('#probe').textContent(), /^origin=null$/m, 'HTML output runs in the sandbox')
    const height = await notebook.locator('[data-output="html"] iframe').evaluate((element) => element.getBoundingClientRect().height)
    assert.ok(height > 40 && height < 1600, `HTML output fits its content (${height}px)`)
    await page.close()
  }

  assert.deepEqual(errors, [])
  console.log('Files viewers: grid, code, sandboxed HTML, and notebooks work')
} finally {
  await browser?.close()
  await server?.close()
}
