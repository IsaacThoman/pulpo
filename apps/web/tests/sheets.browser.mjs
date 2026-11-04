// Run with: npm run test:sheets -w @pulpo/web (build @pulpo/client-core first)
// Install the browser once with: npx playwright install chromium
// Drives the spreadsheet editor in its dev harness (tests/sheets): keyboard and mouse editing,
// formulas, clipboard, fill, structure, sheets, undo, collaboration between two replicas, export,
// read-only mode, touch, and rendering performance.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
let server
let browser
const results = []

async function step(name, run) {
  const started = performance.now()
  await run()
  results.push(`ok ${name} (${Math.round(performance.now() - started)}ms)`)
}

try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { include: ['yjs', 'y-protocols/awareness'] } })
  await server.listen()
  const base = `${server.resolvedUrls.local[0]}tests/sheets/index.html`
  browser = await chromium.launch()

  const open = async (query = '', options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], ...options })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}${query}`)
    await page.waitForSelector('[data-replica="0"] .pulpo-sheet canvas')
    await page.waitForFunction(() => window.__sheets?.views[0])
    return { page, errors, context }
  }
  const inputText = (page, row, col, replica = 0) => page.evaluate(([r, c, i]) => window.__sheets.views[i].inputText(r, c), [row, col, replica])
  const shown = (page, row, col, replica = 0) => page.evaluate(([r, c, i]) => window.__sheets.views[i].displayText(r, c), [row, col, replica])
  const go = async (page, ref, replica = 0) => {
    const box = page.locator(`[data-replica="${replica}"]`).getByLabel('Name box')
    await box.fill(ref)
    await box.press('Enter')
  }
  /** Center of a cell in page coordinates. */
  const cellPoint = (page, row, col, replica = 0) =>
    page.evaluate(async ([r, c, i]) => {
      // Overlays (charts, images) move on the next frame after a scroll.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const sheetView = window.__sheets.views[i]
      const rect = sheetView.cellRect(r, c)
      const root = sheetView.root.getBoundingClientRect()
      return { x: root.left + rect.x + rect.width / 2, y: root.top + rect.y + rect.height / 2, width: rect.width, height: rect.height, left: root.left + rect.x, top: root.top + rect.y }
    }, [row, col, replica])

  const { page, errors } = await open('?split=1')

  await step('typing, Enter and Tab flows', async () => {
    await go(page, 'A20')
    await page.keyboard.type('alpha')
    await page.keyboard.press('Tab')
    await page.keyboard.type('12.5')
    await page.keyboard.press('Enter')
    // Enter after Tab returns to the column the row started in, like Excel… we move down one.
    assert.equal(await inputText(page, 19, 0), 'alpha')
    assert.equal(await inputText(page, 19, 1), '12.5')
    const state = await page.evaluate(() => window.__sheets.views[0].getState().selectionLabel)
    assert.equal(state, 'B21')
    await page.keyboard.type('x')
    await page.keyboard.press('Escape')
    assert.equal(await inputText(page, 20, 1), '', 'Escape cancels')
  })

  await step('formula with arrow-key pointing and colored references', async () => {
    await go(page, 'C20')
    await page.keyboard.type('=B20*')
    await page.keyboard.press('ArrowUp')
    const highlights = await page.evaluate(() => window.__sheets.views[0].scene().referenceHighlights.length)
    assert.equal(highlights, 2)
    await page.keyboard.press('Enter')
    assert.equal(await inputText(page, 19, 2), '=B20*C19')
  })

  await step('click-to-reference with the mouse', async () => {
    await go(page, 'D20')
    await page.keyboard.type('=SUM(')
    const from = await cellPoint(page, 4, 2)
    const to = await cellPoint(page, 6, 2)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.type(')')
    await page.keyboard.press('Enter')
    assert.equal(await inputText(page, 19, 3), '=SUM(C5:C7)')
  })

  await step('formula bar edits the active cell', async () => {
    await go(page, 'E20')
    const bar = page.locator('[data-replica="0"]').getByLabel('Formula bar')
    await bar.click()
    await bar.fill('from bar')
    await bar.press('Enter')
    assert.equal(await inputText(page, 19, 4), 'from bar')
  })

  await step('bold from the toolbar and keyboard, undo and redo', async () => {
    await go(page, 'A20')
    await page.locator('[data-replica="0"]').getByRole('button', { name: 'Bold' }).click()
    assert.equal(await page.evaluate(() => window.__sheets.views[0].styleAt(19, 0).bold), true)
    await page.keyboard.press(`${mod}+b`)
    assert.equal(await page.evaluate(() => window.__sheets.views[0].styleAt(19, 0).bold), false)
    await page.keyboard.press(`${mod}+z`)
    assert.equal(await page.evaluate(() => window.__sheets.views[0].styleAt(19, 0).bold), true)
    await page.keyboard.press(`${mod}+Shift+z`)
    assert.equal(await page.evaluate(() => window.__sheets.views[0].styleAt(19, 0).bold), false)
  })

  await step('copy and paste within the sheet keeps formulas relative', async () => {
    await go(page, 'C20')
    await page.keyboard.press(`${mod}+c`)
    await go(page, 'C22')
    await page.keyboard.press(`${mod}+v`)
    assert.equal(await inputText(page, 21, 2), '=B22*C21')
  })

  await step('paste from other spreadsheets (TSV and HTML)', async () => {
    await go(page, 'H20')
    await page.evaluate(() => window.__sheets.views[0].clipboard.paste({ text: 'one\ttwo\n3\t"multi\nline"' }))
    assert.equal(await inputText(page, 19, 7), 'one')
    assert.equal(await inputText(page, 20, 8), 'multi\nline')
    await go(page, 'H23')
    await page.evaluate(() => window.__sheets.views[0].clipboard.paste({ html: '<table><tr><td style="font-weight:bold;background:#ff0000">Red</td><td>4</td></tr></table>' }))
    assert.equal(await inputText(page, 22, 7), 'Red')
    const style = await page.evaluate(() => window.__sheets.views[0].styleAt(22, 7))
    assert.equal(style.bold, true)
    assert.deepEqual(style.fill, { rgb: 'FF0000' })
  })

  await step('fill handle continues a series', async () => {
    await go(page, 'J20')
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    await page.keyboard.type('3')
    await page.keyboard.press('Enter')
    await go(page, 'J20:J21')
    const corner = await cellPoint(page, 20, 9)
    const target = await cellPoint(page, 23, 9)
    await page.mouse.move(corner.left + corner.width - 1, corner.top + corner.height - 1)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 5 })
    await page.mouse.up()
    assert.deepEqual(await Promise.all([21, 22, 23].map((row) => inputText(page, row, 9))), ['5', '7', '9'])
  })

  await step('insert and delete rows move cells and formulas', async () => {
    await go(page, 'A20')
    await page.evaluate(() => window.__sheets.views[0].insert('row', 'before'))
    assert.equal(await inputText(page, 20, 0), 'alpha')
    assert.equal(await inputText(page, 20, 2), '=B21*C19')
    await page.evaluate(() => window.__sheets.views[0].deleteLines('row'))
    assert.equal(await inputText(page, 19, 0), 'alpha')
  })

  await step('context menu inserts a row', async () => {
    const point = await cellPoint(page, 19, 0)
    await page.mouse.click(point.x, point.y)
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Insert row above' }).click()
    assert.equal(await inputText(page, 20, 0), 'alpha')
    // The grid has the keyboard again once the menu closes.
    await page.waitForFunction(() => document.activeElement?.classList.contains('pulpo-sheet-input'))
    await page.keyboard.press(`${mod}+z`)
    assert.equal(await inputText(page, 19, 0), 'alpha')
  })

  await step('collaborators see each other’s edits and cursors', async () => {
    await page.waitForFunction(() => window.__sheets.views[1].inputText(19, 0) === 'alpha')
    await go(page, 'B25', 1)
    await page.keyboard.type('from Grace')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__sheets.views[0].inputText(24, 1) === 'from Grace')
    const remote = await page.evaluate(() => window.__sheets.views[0].scene().remote.map((entry) => entry.name))
    assert.deepEqual(remote, ['Grace'])
  })

  await step('concurrent structural and content edits converge', async () => {
    // 300ms of network latency, so both edits happen before either replica sees the other's.
    const { page: slow, errors: slowErrors } = await open('?split=1&latency=300')
    await slow.evaluate(() => {
      const [a, b] = window.__sheets.views
      a.select({ top: 29, left: 0, bottom: 29, right: 0 })
      a.insert('row', 'before')
      b.select({ top: 30, left: 0, bottom: 30, right: 0 })
      b.beginEdit('typed', true)
      b.commitEdit()
      a.select({ top: 0, left: 10, bottom: 0, right: 10 })
      a.toggleStyle('bold')
      b.select({ top: 0, left: 10, bottom: 0, right: 10 })
      b.toggleStyle('italic')
    })
    await slow.waitForFunction(() => window.__sheets.views.every((entry) => entry.inputText(31, 0) === 'typed'))
    const styles = await slow.evaluate(() => window.__sheets.views.map((entry) => [entry.styleAt(0, 10).bold, entry.styleAt(0, 10).italic]))
    assert.deepEqual(styles, [[true, true], [true, true]])
    assert.deepEqual(slowErrors, [])
    await slow.close()
  })

  await step('sheet tabs: add and rename', async () => {
    const editor = page.locator('[data-replica="0"]')
    await editor.getByRole('button', { name: 'Add sheet' }).click()
    await editor.getByRole('tab', { name: /Sheet4/ }).dblclick()
    const input = editor.getByLabel('Sheet name')
    await input.fill('Bad/Name')
    await input.press('Enter')
    await editor.getByRole('alert').waitFor()
    await input.fill('Forecast')
    await input.press('Enter')
    await editor.getByRole('tab', { name: /Forecast/ }).waitFor()
    await page.locator('[data-replica="1"]').getByRole('tab', { name: /Forecast/ }).waitFor()
    await editor.getByRole('tab', { name: /Budget/ }).click()
  })

  await step('find and replace', async () => {
    await page.keyboard.press(`${mod}+f`)
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Find', { exact: true }).fill('from Grace')
    await dialog.getByLabel('Replace with').fill('by Grace')
    await dialog.getByRole('button', { name: 'Replace all' }).click()
    await dialog.getByText('Replaced 1 cell').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await inputText(page, 24, 1), 'by Grace')
  })

  await step('exports a valid xlsx with the edits', async () => {
    const base64 = await page.evaluate(() => window.__sheets.exportFile('Budget.xlsx'))
    assert.ok(base64.length > 1000)
    const text = await page.evaluate(() => window.__sheets.toText(1))
    assert.match(text, /by Grace/)
    assert.match(text, /## Forecast/)
  })

  await step('scrolls 100k rows smoothly', async () => {
    const timing = await page.evaluate(async () => {
      const sheetView = window.__sheets.views[0]
      sheetView.workbook.transact(() => {
        const sheet = sheetView.sheet
        sheet.rows.ensure(100_000)
        sheet.cols.ensure(30)
        for (let row = 100; row < 100_000; row += 1) sheet.cells.set(sheet.keyAt(row, row % 30), { v: row })
      })
      const frames = []
      for (let index = 0; index < 30; index++) {
        sheetView.scroller.scrollTop += 4000
        const started = performance.now()
        sheetView.renderNow()
        frames.push(performance.now() - started)
      }
      frames.sort((a, b) => a - b)
      return { median: frames[15], worst: frames[29] }
    })
    assert.ok(timing.median < 30, `median frame ${timing.median}ms`)
    results.push(`  frame median ${timing.median.toFixed(1)}ms, worst ${timing.worst.toFixed(1)}ms`)
  })

  assert.deepEqual(errors, [])

  await step('read-only mode refuses edits', async () => {
    const { page: readOnly, errors: readErrors } = await open('?readonly=1')
    await go(readOnly, 'A30')
    await readOnly.keyboard.type('nope')
    await readOnly.keyboard.press('Enter')
    assert.equal(await inputText(readOnly, 29, 0), '')
    assert.equal(await readOnly.locator('[data-replica="0"]').getByRole('button', { name: 'Bold' }).isDisabled(), true)
    assert.deepEqual(readErrors, [])
    await readOnly.close()
  })

  await step('touch: tap selects, double tap edits', async () => {
    const { page: touch, errors: touchErrors } = await open('', { hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } })
    const point = await cellPoint(touch, 6, 1)
    await touch.touchscreen.tap(point.x, point.y)
    await touch.waitForFunction(() => window.__sheets.views[0].getState().selectionLabel === 'B7')
    await touch.touchscreen.tap(point.x, point.y)
    await touch.waitForTimeout(50)
    await touch.touchscreen.tap(point.x, point.y)
    await touch.waitForFunction(() => !!window.__sheets.views[0].editing)
    assert.deepEqual(touchErrors, [])
    await touch.close()
  })

  await step('CSV opens as one sheet of values', async () => {
    const csv = `data:text/csv;base64,${Buffer.from('name,qty\napple,3\n"pear, ripe",5\n').toString('base64')}`
    const { page: csvPage, errors: csvErrors } = await open(`?file=${encodeURIComponent(csv)}&name=fruit.csv`)
    assert.equal(await shown(csvPage, 2, 0), 'pear, ripe')
    await go(csvPage, 'C2')
    await csvPage.keyboard.type('=1+1')
    await csvPage.keyboard.press('Enter')
    assert.equal(await inputText(csvPage, 1, 2), "'=1+1")
    const exported = Buffer.from(await csvPage.evaluate(() => window.__sheets.exportFile('fruit.csv')), 'base64').toString()
    assert.equal(exported, 'name,qty,\napple,3,=1+1\n"pear, ripe",5,\n')
    assert.deepEqual(csvErrors, [])
    await csvPage.close()
  })

  for (const line of results) console.log(line)
  console.log('spreadsheet editor works in the browser')
} finally {
  await browser?.close()
  await server?.close()
}
