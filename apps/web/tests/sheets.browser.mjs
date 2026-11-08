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

  /** Center of a column (or row) header in page coordinates, and the line's leading edge. */
  const header = (page, kind, index, replica = 0) =>
    page.evaluate(async ([k, i, r]) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const sheetView = window.__sheets.views[r]
      const root = sheetView.root.getBoundingClientRect()
      const rect = sheetView.cellRect(k === 'col' ? 0 : i, k === 'col' ? i : 0)
      return k === 'col'
        ? { x: root.left + rect.x + rect.width / 2, y: root.top + sheetView.headerHeight / 2, edge: root.left + rect.x }
        : { x: root.left + sheetView.headerWidth / 2, y: root.top + rect.y + rect.height / 2, edge: root.top + rect.y }
    }, [kind, index, replica])

  const { page, errors } = await open('?split=1')

  await step('typing, Enter and Tab flows', async () => {
    await go(page, 'A20')
    await page.keyboard.type('alpha')
    await page.keyboard.press('Tab')
    await page.keyboard.type('12.5')
    await page.keyboard.press('Enter')
    // Enter after Tab returns to the column the row started in, like Excel and Google.
    assert.equal(await inputText(page, 19, 0), 'alpha')
    assert.equal(await inputText(page, 19, 1), '12.5')
    const state = await page.evaluate(() => window.__sheets.views[0].getState().selectionLabel)
    assert.equal(state, 'A21')
    await page.keyboard.type('x')
    await page.keyboard.press('Escape')
    assert.equal(await inputText(page, 20, 0), '', 'Escape cancels')
  })

  await step('Select All Ctrl+Enter refuses expansion and stays responsive', async () => {
    const { page: safety, errors: safetyErrors, context } = await open()
    await go(safety, 'XFD1048576')
    await safety.keyboard.press(`${mod}+a`)
    const before = await safety.evaluate(() => window.__sheets.views[0].sheet.cells.size)
    await safety.keyboard.type('too large')
    const started = performance.now()
    await safety.keyboard.press(`${mod}+Enter`)
    const state = await safety.evaluate(() => {
      const view = window.__sheets.views[0]
      return { cells: view.sheet.cells.size, draft: view.editing?.text, selection: view.getState().selectionLabel }
    })
    assert.ok(performance.now() - started < 2000, 'oversized fill must promptly return control to the event loop')
    assert.equal(state.cells, before, 'refusal writes no cells')
    assert.equal(state.draft, 'too large', 'refusal retains the draft')
    await safety.keyboard.press('Escape')
    await go(safety, 'A20')
    await safety.keyboard.type('still responsive')
    await safety.keyboard.press('Enter')
    assert.equal(await inputText(safety, 19, 0), 'still responsive')
    assert.deepEqual(safetyErrors, [])
    await context.close()
  })

  await step('Ctrl+Enter preflights destination validation atomically and retains the draft', async () => {
    const { page: validation, errors: validationErrors, context } = await open()
    await validation.evaluate(() => {
      const view = window.__sheets.views[0]
      const sheet = view.workbook.addSheet('Validation regression')
      view.setActiveSheet(sheet.id)
      sheet.setCell(0, 1, { v: 1 })
      sheet.setCell(1, 1, { v: 100 })
      sheet.dv.set('test', { ranges: [sheet.rangeIds({ top: 0, left: 0, bottom: 1, right: 0 })], type: 'whole', operator: 'greaterThan', formula1: 'B1', error: 'Value is too small' })
      view.undoManager.clear()
    })
    await go(validation, 'A1:A2')
    const before = await validation.evaluate(() => JSON.stringify(window.__sheets.views[0].workbook.doc.toJSON()))
    await validation.keyboard.type('50')
    await validation.keyboard.press(`${mod}+Enter`)
    await validation.getByRole('alert').filter({ hasText: 'Value is too small' }).waitFor()
    const rejected = await validation.evaluate(() => {
      const view = window.__sheets.views[0]
      return { doc: JSON.stringify(view.workbook.doc.toJSON()), undo: view.undoManager.undoStack.length, draft: view.editing?.text }
    })
    assert.deepEqual(rejected, { doc: before, undo: 0, draft: '50' })
    await validation.keyboard.press('Escape')
    await go(validation, 'A1:A2')
    await validation.keyboard.type('150')
    await validation.keyboard.press(`${mod}+Enter`)
    assert.deepEqual(await Promise.all([0, 1].map((row) => inputText(validation, row, 0))), ['150', '150'])
    await validation.keyboard.press(`${mod}+z`)
    assert.deepEqual(await Promise.all([0, 1].map((row) => inputText(validation, row, 0))), ['', ''])
    // Paste and fill-handle commands keep their existing bulk-entry behavior.
    await validation.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('A1')
      view.clipboard.paste({ text: '50\n50' }, { values: true })
    })
    assert.deepEqual(await Promise.all([0, 1].map((row) => inputText(validation, row, 0))), ['50', '50'])
    assert.deepEqual(validationErrors, [])
    await context.close()
  })

  await step('typed legacy-array members are refused; dynamic spill blockers can be cleared', async () => {
    const { page: arrays, errors: arrayErrors, context } = await open()
    await arrays.evaluate(() => {
      const view = window.__sheets.views[0]
      view.sheet.setCell(19, 0, { f: 'SEQUENCE(3)', array: { rows: 3, cols: 1 }, spillCache: [[1], [2], [3]] })
    })
    await go(arrays, 'A21')
    await arrays.keyboard.type('99')
    await arrays.keyboard.press('Enter')
    await arrays.getByRole('alert').filter({ hasText: "You can't change part of an array." }).waitFor()
    assert.equal(await inputText(arrays, 20, 0), '')
    assert.equal(await shown(arrays, 20, 0), '2')
    assert.equal(await arrays.evaluate(() => window.__sheets.views[0].editing?.text), '99')
    await arrays.keyboard.press('Escape')
    await go(arrays, 'D20')
    await arrays.keyboard.type('=SEQUENCE(3)')
    await arrays.keyboard.press('Enter')
    await arrays.keyboard.type('99')
    await arrays.keyboard.press('Enter')
    assert.equal(await inputText(arrays, 20, 3), '99')
    assert.equal(await shown(arrays, 19, 3), '#SPILL!')
    await go(arrays, 'D21')
    await arrays.keyboard.press('Delete')
    assert.equal(await shown(arrays, 19, 3), '1')
    assert.equal(await shown(arrays, 20, 3), '2')
    assert.deepEqual(arrayErrors, [])
    await context.close()
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

  await step('system clipboard keeps filtered row positions and copy-time values', async () => {
    await go(page, 'N60')
    await page.evaluate(() => {
      const view = window.__sheets.views[0]
      view.clipboard.paste({ text: '10\t=A60\n99\t=A61\n20\t=A62' })
      // Use references to the adjacent numeric source column.
      view.sheet.setCell(59, 14, { f: 'N60' })
      view.sheet.setCell(60, 14, { f: 'N61' })
      view.sheet.setCell(61, 14, { f: 'N62' })
      view.sheet.setRowProp([60], 'hidden', true)
    })
    await go(page, 'O60:O62')
    await page.keyboard.press(`${mod}+c`)
    const captured = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      return { html: await (await items[0].getType('text/html')).text(), text: await (await items[0].getType('text/plain')).text() }
    })
    assert.equal(captured.text, '10\n20')
    await go(page, 'O65')
    await page.keyboard.press(`${mod}+v`)
    assert.equal(await inputText(page, 64, 14), '=N65')
    assert.equal(await inputText(page, 65, 14), '=N66')
    await page.evaluate((data) => {
      const view = window.__sheets.views[0]
      view.sheet.setCell(59, 13, { v: 999 })
      view.goTo('Q65')
      view.clipboard.paste(data, { values: true })
      view.sheet.setRowProp([60], 'hidden', undefined)
    }, captured)
    assert.equal(await inputText(page, 64, 16), '10')
    assert.equal(await inputText(page, 65, 16), '20')
  })

  await step('overlapping system clipboard paste-values uses a snapshot and undoes once', async () => {
    await go(page, 'N70')
    await page.evaluate(() => window.__sheets.views[0].clipboard.paste({ text: '10\t=N70\n20\t=N71' }))
    await go(page, 'O70:O71')
    await page.keyboard.press(`${mod}+c`)
    await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      const html = await (await items[0].getType('text/html')).text()
      const view = window.__sheets.views[0]
      view.goTo('O71')
      view.clipboard.paste({ html }, { values: true })
    })
    assert.equal(await inputText(page, 70, 14), '10')
    assert.equal(await inputText(page, 71, 14), '20')
    await page.evaluate(() => window.__sheets.views[0].undo())
    assert.equal(await inputText(page, 70, 14), '=N71')
    assert.equal(await inputText(page, 71, 14), '')
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

  await step('menu bar: freeze, undo, the shortcuts list, and the current sheet as CSV', async () => {
    const { page: menus, errors: menuErrors, context } = await open()
    const bar = menus.getByRole('menubar', { name: 'Menu bar' })
    const view = () => menus.evaluate(() => window.__sheets.views[0].getState())
    await go(menus, 'C3')
    const frozen = (await view()).frozen
    await bar.getByRole('menuitem', { name: 'View' }).click()
    await menus.getByRole('menuitem', { name: 'Freeze' }).hover()
    await menus.getByRole('menuitem', { name: 'Freeze first row' }).click()
    assert.deepEqual((await view()).frozen, { rows: 1, cols: frozen.cols })
    // Typing goes back to the grid once the menu closes.
    await menus.waitForFunction(() => document.activeElement === window.__sheets.views[0].input)
    await bar.getByRole('menuitem', { name: 'Edit' }).click()
    await menus.getByRole('menuitem', { name: 'Undo' }).click()
    assert.deepEqual((await view()).frozen, frozen)

    // Cmd/Ctrl+/ opens the searchable shortcuts list from the grid.
    await menus.waitForFunction(() => document.activeElement === window.__sheets.views[0].input)
    await menus.keyboard.press(`${mod}+/`)
    const dialog = menus.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await dialog.getByRole('searchbox', { name: 'Search shortcuts' }).fill('fill down')
    await dialog.getByText('Fill down', { exact: true }).waitFor()
    await menus.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })

    // File ▸ Download ▸ CSV writes the sheet in view, which the workbook does not record.
    const sheets = (await view()).sheets
    const second = sheets.find((sheet) => sheet.id !== sheets[0].id && sheet.state === 'visible')
    if (second) await menus.locator('[data-replica="0"]').getByRole('tab', { name: new RegExp(second.name) }).click()
    const { sheetId } = await view()
    const sheetName = (await view()).sheets.find((sheet) => sheet.id === sheetId).name
    const expected = await menus.evaluate(() => window.__sheets.views[0].displayText(0, 0))
    const recorded = () => menus.evaluate(() => window.__sheets.views[0].workbook.metaValue('activeSheet') ?? null)
    const before = await recorded()
    const download = menus.waitForEvent('download')
    await bar.getByRole('menuitem', { name: 'File' }).click()
    await menus.getByRole('menuitem', { name: 'Download' }).hover()
    await menus.getByRole('menuitem', { name: 'Comma-separated values (.csv, current sheet)' }).click()
    const file = await download
    assert.equal(file.suggestedFilename(), `Budget - ${sheetName}.csv`)
    const chunks = []
    for await (const chunk of await file.createReadStream()) chunks.push(chunk)
    const csv = Buffer.concat(chunks).toString('utf8')
    assert.ok(csv.length > 0)
    if (expected) assert.ok(csv.includes(expected.replaceAll('"', '""')), `the CSV has ${expected}: ${csv.slice(0, 80)}`)
    // The download leaves the shared workbook as it was.
    assert.equal(await recorded(), before)
    assert.deepEqual(menuErrors, [])
    await context.close()
  })

  await step('filter-menu sorts preserve active filter visibility and undo once', async () => {
    const { page: filtered, errors: filterErrors } = await open('?split=1')
    await filtered.evaluate(() => {
      const view = window.__sheets.views[0]
      const sheet = view.workbook.addSheet('Sort regression')
      view.setActiveSheet(sheet.id)
      view.goTo('A1')
      view.clipboard.paste({ text: 'Fruit\tQty\napple\t2\npear\t1\napple\t1' })
      view.select({ top: 0, left: 0, bottom: 3, right: 1 })
      view.toggleFilter()
    })
    const openMenu = async () => {
      const point = await cellPoint(filtered, 0, 0)
      await filtered.mouse.click(point.left + point.width - 8, point.top + point.height - 8)
      await filtered.locator('[data-replica="0"]').getByRole('button', { name: 'Sort Z to A', exact: true }).last().waitFor()
    }
    await filtered.waitForFunction(() => window.__sheets.views[1].workbook.sheets().some((sheet) => sheet.name === 'Sort regression'))
    await filtered.evaluate(() => {
      const view = window.__sheets.views[1]
      view.setActiveSheet(view.workbook.sheets().find((sheet) => sheet.name === 'Sort regression').id)
    })
    await openMenu()
    await filtered.getByRole('checkbox', { name: 'pear' }).uncheck()
    await filtered.getByRole('button', { name: 'OK', exact: true }).click()
    await openMenu()
    await filtered.locator('[data-replica="0"]').getByRole('button', { name: 'Sort Z to A', exact: true }).last().click()
    const state = () => filtered.evaluate(() => {
      const view = window.__sheets.views[0]
      return [1, 2, 3].map((r) => [view.inputText(r, 0), !!view.sheet.rowProp(r, 'hidden')])
    })
    assert.deepEqual(await state(), [['pear', true], ['apple', false], ['apple', false]])
    await filtered.waitForFunction(() => window.__sheets.views[1].inputText(1, 0) === 'pear' && window.__sheets.views[1].sheet.rowProp(1, 'hidden'))
    await filtered.evaluate(() => window.__sheets.views[0].undo())
    assert.deepEqual(await state(), [['apple', false], ['pear', true], ['apple', false]])
    await openMenu()
    await filtered.locator('[data-replica="0"]').getByRole('button', { name: 'Sort A to Z', exact: true }).last().click()
    assert.deepEqual(await state(), [['apple', false], ['apple', false], ['pear', true]])
    await openMenu()
    await filtered.getByRole('button', { name: 'Clear filter', exact: true }).click()
    assert.deepEqual(await state(), [['apple', false], ['apple', false], ['pear', false]])
    // Array refusal is shown to the user, rather than becoming an uncaught menu exception.
    await filtered.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('C2')
      view.beginEdit('=SEQUENCE(3,1,3,-1)', true)
      view.commitEdit()
      view.select({ top: 1, left: 2, bottom: 3, right: 2 })
      view.sort(false)
    })
    await filtered.getByRole('alert').filter({ hasText: 'array formulas' }).waitFor()
    assert.equal(await inputText(filtered, 1, 2), '=SEQUENCE(3,1,3,-1)')
    assert.deepEqual(filterErrors, [])
    await filtered.close()
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

  await step('review diff lists changed cells and inserted rows', async () => {
    const { page: review, errors: reviewErrors } = await open('?diff=1')
    await review.evaluate(() => {
      const sheetView = window.__sheets.views[0]
      sheetView.select({ top: 6, left: 3, bottom: 6, right: 3 })
      sheetView.beginEdit('9500', true)
      sheetView.commitEdit()
      sheetView.select({ top: 9, left: 0, bottom: 9, right: 0 })
      sheetView.insert('row', 'before')
    })
    const panel = review.getByTestId('sheet-diff')
    await panel.getByText('Row 10 inserted').waitFor()
    await panel.getByRole('rowheader', { name: 'D7' }).waitFor()
    assert.equal(await panel.getByRole('rowheader', { name: 'G11' }).count(), 0, 'formulas that only moved are not changes')
    assert.deepEqual(reviewErrors, [])
    await review.close()
  })

  // Office parity: a fresh shared session, so earlier steps can't move these cells.
  const { page: parity, errors: parityErrors, context: parityContext } = await open('?split=1')
  const label = (replica = 0) => parity.evaluate((r) => window.__sheets.views[r].getState().selectionLabel, replica)
  await parity.evaluate(() => {
    const view = window.__sheets.views[0]
    const sheet = view.workbook.addSheet('Parity')
    view.setActiveSheet(sheet.id)
    view.goTo('A1')
    view.clipboard.paste({ text: 'keep\t\t\t\tdrop' })
  })

  await step('header right-click selects the column the menu acts on', async () => {
    await go(parity, 'A1')
    const e = await header(parity, 'col', 4)
    await parity.mouse.click(e.x, e.y, { button: 'right' })
    assert.equal(await label(), 'E:E')
    await parity.getByRole('menuitem', { name: 'Delete column', exact: true }).click()
    assert.equal(await inputText(parity, 0, 0), 'keep')
    assert.equal(await inputText(parity, 0, 4), '')
    // A cell inside selected whole columns offers column commands only.
    const b = await header(parity, 'col', 1)
    await parity.mouse.click(b.x, b.y)
    const inside = await cellPoint(parity, 4, 1)
    await parity.mouse.click(inside.x, inside.y, { button: 'right' })
    await parity.getByRole('menuitem', { name: 'Delete column', exact: true }).waitFor()
    assert.equal(await parity.getByRole('menuitem', { name: 'Delete row' }).count(), 0)
    assert.equal(await label(), 'B:B')
    await parity.keyboard.press('Escape')
  })

  await step('hidden column markers unhide with one click', async () => {
    const c = await header(parity, 'col', 2)
    await parity.mouse.click(c.x, c.y, { button: 'right' })
    await parity.getByRole('menuitem', { name: 'Hide column', exact: true }).click()
    assert.equal(await parity.evaluate(() => window.__sheets.views[0].cols.isHidden(2)), true)
    assert.deepEqual(await parity.evaluate(() => window.__sheets.views[0].scene().hiddenMarks.cols), [3])
    const d = await header(parity, 'col', 3)
    await parity.mouse.move(d.edge + 8, d.y)
    assert.equal(await parity.evaluate(() => window.__sheets.views[0].scroller.style.cursor), 'pointer')
    await parity.mouse.click(d.edge + 8, d.y)
    assert.equal(await parity.evaluate(() => window.__sheets.views[0].cols.isHidden(2)), false)
  })

  await step('AutoSum from the keyboard', async () => {
    await parity.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('G2')
      view.clipboard.paste({ text: '1\n2\n3' })
    })
    await go(parity, 'G5')
    await parity.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+t' : 'Alt+Equal')
    assert.equal(await parity.evaluate(() => window.__sheets.views[0].editing?.text), '=SUM(G2:G4)')
    await parity.keyboard.press('Enter')
    assert.equal(await inputText(parity, 4, 6), '=SUM(G2:G4)')
    assert.equal(await shown(parity, 4, 6), '6')
    assert.equal(await label(), 'G6')
  })

  await step('Ctrl+Shift+V pastes values only', async () => {
    await go(parity, 'G5')
    await parity.keyboard.press(`${mod}+c`)
    await go(parity, 'N2')
    // Chrome on a Mac fires no paste event for Cmd+Shift+V, so the clipboard is read.
    await parity.keyboard.press(`${mod}+Shift+v`)
    await parity.waitForFunction(() => window.__sheets.views[0].inputText(1, 13) !== '')
    assert.equal(await inputText(parity, 1, 13), '6')
    await parity.keyboard.press('Escape')
  })

  await step('Ctrl+Shift+4 and Ctrl+Shift+5 format currency and percent', async () => {
    await go(parity, 'H2')
    await parity.keyboard.type('1234.5')
    await parity.keyboard.press('Enter')
    await go(parity, 'H2')
    await parity.keyboard.press('Control+Shift+Digit4')
    assert.equal(await shown(parity, 1, 7), '$1,234.50')
    await parity.keyboard.press('Control+Shift+Digit5')
    assert.equal(await shown(parity, 1, 7), '123450.00%')
    await parity.keyboard.press(`${mod}+z`)
    assert.equal(await shown(parity, 1, 7), '$1,234.50')
  })

  await step('Ctrl+9 hides the selected rows and Ctrl+Shift+9 shows them', async () => {
    await go(parity, 'A10:A11')
    await parity.keyboard.press('Control+Digit9')
    assert.deepEqual(await parity.evaluate(() => [9, 10, 11].map((row) => window.__sheets.views[0].rows.isHidden(row))), [true, true, false])
    await parity.keyboard.press('Control+Shift+Digit9')
    assert.deepEqual(await parity.evaluate(() => [9, 10].map((row) => window.__sheets.views[0].rows.isHidden(row))), [false, false])
    if (process.platform === 'darwin') {
      // Cmd+0 stays the browser's actual size on a Mac.
      await parity.keyboard.press('Meta+Digit0')
      assert.equal(await parity.evaluate(() => window.__sheets.views[0].cols.isHidden(0)), false)
    }
  })

  await step('data validation lists open and pick from the keyboard', async () => {
    await parity.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('J2:J4')
      view.setValidation({ type: 'list', formula1: '"Low,Medium,High"', showErrorMessage: true })
    })
    await go(parity, 'J3')
    await parity.keyboard.press('Alt+ArrowDown')
    const list = parity.locator('[data-replica="0"] .pulpo-sheet-popup[role="listbox"]')
    await list.waitFor()
    await parity.keyboard.press('ArrowDown')
    assert.equal(await list.locator('[aria-selected="true"]').textContent(), 'Medium')
    await parity.keyboard.press('Enter')
    assert.equal(await inputText(parity, 2, 9), 'Medium')
    assert.equal(await list.count(), 0)
    await parity.keyboard.type('Huge')
    await parity.keyboard.press('Enter')
    await parity.locator('[data-replica="0"]').getByRole('alert').waitFor()
    await parity.keyboard.press('Escape')
    assert.equal(await inputText(parity, 2, 9), 'Medium')
  })

  await step('conditional format rules render for collaborators', async () => {
    await parity.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('G2:G4')
      view.addConditionalRule({ type: 'cellIs', operator: 'greaterThan', formulas: ['1'], style: 'lightRedFillDarkRedText' })
    })
    const fills = () => parity.evaluate(() => [1, 2, 3].map((row) => window.__sheets.views[0].cellRender(row, 6).overlay?.style?.fill?.rgb ?? null))
    assert.deepEqual(await fills(), [null, 'FFFFC7CE', 'FFFFC7CE'])
    await parity.waitForFunction(() => {
      const view = window.__sheets.views[1]
      const sheet = view.workbook.sheets().find((entry) => entry.name === 'Parity')
      if (sheet && view.sheetId !== sheet.id) view.setActiveSheet(sheet.id)
      return view.cellRender(3, 6).overlay?.style?.fill?.rgb === 'FFFFC7CE'
    })
    assert.equal(await parity.evaluate(() => window.__sheets.views[0].workbook.metaValue('stylesXml') === window.__sheets.views[1].workbook.metaValue('stylesXml')), true)
  })

  await step('paint format copies formats to the clicked cell', async () => {
    await parity.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('L2')
      view.setStyle({ bold: true, fill: { rgb: 'FFFF00' } })
      view.startFormatPainter()
    })
    await go(parity, 'D8')
    const target = await cellPoint(parity, 7, 3)
    await parity.mouse.move(target.x, target.y)
    assert.equal(await parity.evaluate(() => window.__sheets.views[0].scroller.style.cursor), 'copy')
    await parity.mouse.click(target.x, target.y)
    const painted = await parity.evaluate(() => {
      const view = window.__sheets.views[0]
      return { bold: view.styleAt(7, 3).bold, fill: view.styleAt(7, 3).fill, painter: view.getState().formatPainter ?? null }
    })
    assert.deepEqual(painted, { bold: true, fill: { rgb: 'FFFF00' }, painter: null })
  })

  await step('dragging the selection border moves the cells', async () => {
    await parity.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('B12')
      view.clipboard.paste({ text: 'move me\t=B12' })
    })
    await go(parity, 'B12:C12')
    const start = await cellPoint(parity, 11, 1)
    const target = await cellPoint(parity, 14, 2)
    // Just below the selection's bottom border, which shows the move cursor.
    await parity.mouse.move(start.x, start.top + start.height + 2)
    assert.equal(await parity.evaluate(() => window.__sheets.views[0].scroller.style.cursor), 'move')
    await parity.mouse.down()
    await parity.mouse.move(target.x, target.y, { steps: 4 })
    await parity.mouse.up()
    assert.deepEqual([await inputText(parity, 13, 2), await inputText(parity, 13, 3), await inputText(parity, 11, 1)], ['move me', '=C14', ''])
    assert.equal(await label(), 'C14:D14')
    await parity.keyboard.press(`${mod}+z`)
    assert.deepEqual([await inputText(parity, 11, 1), await inputText(parity, 11, 2), await inputText(parity, 13, 2)], ['move me', '=B12', ''])
    // A plain click just below the border still selects the cell there.
    await go(parity, 'B12')
    const edge = await cellPoint(parity, 11, 1)
    await parity.mouse.click(edge.x, edge.top + edge.height + 2)
    assert.equal(await label(), 'B13')
    assert.equal(await inputText(parity, 11, 1), 'move me')
  })

  await step('zoom is personal: collaborators keep theirs and undo skips it', async () => {
    await go(parity, 'K2')
    await parity.keyboard.type('last edit')
    await parity.keyboard.press('Enter')
    const steps = await parity.evaluate(() => window.__sheets.views[0].undoManager.undoStack.length)
    // The status bar's zoom, as in Excel (the shared ZoomControl lists presets as radio items).
    await parity.locator('[data-replica="0"]').getByRole('button', { name: 'Zoom', exact: true }).click()
    await parity.getByRole('menuitemradio', { name: '150%' }).click()
    const point = await cellPoint(parity, 6, 3)
    await parity.mouse.move(point.x, point.y)
    await parity.keyboard.down('Control')
    await parity.mouse.wheel(0, -120)
    await parity.keyboard.up('Control')
    const zooms = await parity.evaluate(() => window.__sheets.views.map((view) => view.zoom))
    assert.ok(zooms[0] > 1.5, `wheel zoom ${zooms[0]}`)
    assert.equal(zooms[1], 1)
    assert.equal(await parity.evaluate(() => window.__sheets.views[0].undoManager.undoStack.length), steps)
    await parity.evaluate(() => window.__sheets.views[0].focus())
    await parity.keyboard.press(`${mod}+z`)
    assert.equal(await inputText(parity, 1, 10), '')
    assert.ok(await parity.evaluate(() => window.__sheets.views[0].zoom > 1.5), 'undo leaves the zoom alone')
  })

  assert.deepEqual(parityErrors, [])
  await parityContext.close()

  // Menus, toolbar, dialogs and the status bar, as Office and Google users look for them: a fresh
  // session with its own sheet of data.
  const { page: ui, errors: uiErrors, context: uiContext } = await open()
  const bar = ui.getByRole('menubar', { name: 'Menu bar' })
  const editor = ui.locator('[data-replica="0"]')
  const sheetState = () => ui.evaluate(() => window.__sheets.views[0].getState())
  const gridFocused = () => ui.waitForFunction(() => document.activeElement === window.__sheets.views[0].input)
  const pressed = (name) => ui.waitForFunction((label) => document.querySelector(`[data-replica="0"] [aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true', name)
  /** Opens a submenu from its row: pointing at it, then ArrowRight, as keyboard users do. */
  const openSubmenu = async (name) => {
    await ui.getByRole('menuitem', { name, exact: true }).hover()
    await ui.keyboard.press('ArrowRight')
  }
  const menuPath = async (...names) => {
    await bar.getByRole('menuitem', { name: names[0], exact: true }).click()
    for (const name of names.slice(1, -1)) await openSubmenu(name)
    await ui.getByRole('menuitem', { name: names[names.length - 1], exact: true }).click()
  }
  const summaryIs = (text) => ui.waitForFunction((expected) => document.querySelector('[data-replica="0"] [data-sheet-summary]')?.textContent === expected, text)
  await ui.evaluate(() => {
    const view = window.__sheets.views[0]
    const sheet = view.workbook.addSheet('Ledger')
    view.setActiveSheet(sheet.id)
    view.goTo('A1')
    view.clipboard.paste({ text: 'Region\tSales\tUnits\nNorth\t30\t3\nsouth\t10\t1\nEast\t20\t2\nWest\t10\t4' })
    view.undoManager.clear()
  })

  await step('toolbar $ and % format like Ctrl+Shift+4 and Ctrl+Shift+5', async () => {
    await go(ui, 'B2')
    await editor.getByRole('button', { name: 'Format as currency' }).click()
    assert.equal(await shown(ui, 1, 1), '$30.00')
    await pressed('Format as currency')
    await editor.getByRole('button', { name: 'Format as percent' }).click()
    assert.equal(await shown(ui, 1, 1), '3000.00%')
    // The buttons leave the keyboard in the grid.
    await ui.keyboard.press(`${mod}+z`)
    assert.equal(await shown(ui, 1, 1), '$30.00')
  })

  await step('Paint format: a click paints once, a double-click keeps painting until Escape', async () => {
    await ui.evaluate(() => window.__sheets.views[0].setStyle({ bold: true }))
    const paint = editor.getByRole('button', { name: 'Paint format' })
    await paint.click()
    await pressed('Paint format')
    const a2 = await cellPoint(ui, 1, 0)
    await ui.mouse.click(a2.x, a2.y)
    const bold = (rows) => ui.evaluate((list) => list.map((row) => window.__sheets.views[0].styleAt(row, 0).bold), rows)
    assert.deepEqual(await bold([1, 2]), [true, false])
    assert.equal((await sheetState()).formatPainter ?? null, null)
    await go(ui, 'B2')
    await paint.dblclick()
    assert.deepEqual((await sheetState()).formatPainter, { sticky: true })
    for (const row of [2, 3]) {
      const point = await cellPoint(ui, row, 0)
      await ui.mouse.click(point.x, point.y)
    }
    assert.deepEqual(await ui.evaluate(() => [2, 3].map((row) => window.__sheets.views[0].styleAt(row, 0).numFmt)), ['"$"#,##0.00', '"$"#,##0.00'])
    await ui.keyboard.press('Escape')
    assert.equal((await sheetState()).formatPainter ?? null, null)
  })

  await step('Σ sums the numbers above, Functions ▸ Average totals a range, and fx inserts a function', async () => {
    await go(ui, 'B6')
    await editor.getByRole('button', { name: 'Sum', exact: true }).click()
    assert.equal(await ui.evaluate(() => window.__sheets.views[0].editing?.text), '=SUM(B2:B5)')
    await ui.keyboard.press('Enter')
    assert.equal(await inputText(ui, 5, 1), '=SUM(B2:B5)')
    assert.equal(await ui.evaluate(() => window.__sheets.views[0].valueAt(5, 1)), 70)
    await go(ui, 'C2:C5')
    await editor.getByRole('button', { name: 'Functions' }).click()
    await ui.getByRole('menuitem', { name: 'Average' }).click()
    assert.equal(await inputText(ui, 5, 2), '=AVERAGE(C2:C5)')
    await gridFocused()
    await go(ui, 'D2')
    await editor.getByRole('button', { name: 'Insert function' }).click()
    await openSubmenu('More functions')
    await openSubmenu('Math')
    await ui.getByRole('menuitem', { name: 'ROUND', exact: true }).click()
    assert.equal(await ui.evaluate(() => window.__sheets.views[0].editing?.text), '=ROUND(')
    await gridFocused()
    // The first Escape may only close the function hint list, as in Excel; the next ends the edit.
    for (let tries = 0; tries < 3 && await ui.evaluate(() => !!window.__sheets.views[0].editing); tries++) await ui.keyboard.press('Escape')
    assert.equal(await ui.evaluate(() => window.__sheets.views[0].editing ?? null), null)
  })

  await step('Insert ▸ Rows ▸ above inserts as many rows as are selected', async () => {
    await go(ui, 'A3:A4')
    await menuPath('Insert', 'Rows', 'Insert 2 rows above')
    assert.deepEqual([await inputText(ui, 2, 0), await inputText(ui, 4, 0)], ['', 'south'])
    await gridFocused()
    await ui.keyboard.press(`${mod}+z`)
    assert.equal(await inputText(ui, 2, 0), 'south')
  })

  await step('the menu on three selected rows counts them and resizes them', async () => {
    await go(ui, '2:4')
    const row = await header(ui, 'row', 2)
    await ui.mouse.click(row.x, row.y, { button: 'right' })
    const menu = ui.locator('[data-sheet-context-menu]')
    for (const name of ['Insert 3 rows above', 'Insert 3 rows below', 'Delete rows 2–4', 'Hide rows 2–4']) await menu.getByRole('menuitem', { name, exact: true }).waitFor()
    assert.equal(await menu.getByRole('menuitem', { name: /column/i }).count(), 0)
    assert.equal(await menu.getByRole('menuitem', { name: 'Unhide rows' }).isDisabled(), true)
    await menu.getByRole('menuitem', { name: 'Resize rows 2–4…' }).click()
    const dialog = ui.getByRole('dialog', { name: 'Resize rows 2–4' })
    await dialog.getByLabel('Row height in pixels').fill('40')
    await dialog.getByLabel('Row height in pixels').press('Enter')
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await ui.evaluate(() => [1, 2, 3].map((index) => Math.round(window.__sheets.views[0].rows.size(index)))), [40, 40, 40])
    await gridFocused()
    // The keyboard's menu key (Shift+F10) opens the cell menu at the active cell.
    await go(ui, 'B3')
    await ui.keyboard.press('Shift+F10')
    await menu.getByRole('menuitem', { name: 'Insert row above', exact: true }).waitFor()
    await ui.keyboard.press('Escape')
    await gridFocused()
  })

  await step('sheet tabs: right-click opens the tab menu, All sheets shows hidden sheets', async () => {
    await editor.getByRole('tab', { name: /^Ledger(?! \()/ }).click({ button: 'right' })
    await ui.getByRole('menuitem', { name: 'Duplicate' }).click()
    const copy = editor.getByRole('tab', { name: /^Ledger \(2\)/ })
    await copy.click({ button: 'right' })
    await ui.locator('[data-sheet-tab-menu]').getByRole('menuitem', { name: 'Hide sheet' }).click()
    await copy.waitFor({ state: 'detached' })
    await editor.getByRole('button', { name: 'All sheets' }).click()
    await ui.getByRole('menuitemradio', { name: 'Ledger (2) (hidden)' }).click()
    await copy.waitFor()
    const shownSheet = await sheetState()
    assert.equal(shownSheet.sheets.find((sheet) => sheet.id === shownSheet.sheetId).name, 'Ledger (2)')
    await editor.getByRole('button', { name: 'All sheets' }).click()
    await ui.getByRole('menuitemradio', { name: 'Ledger', exact: true }).click()
    await ui.waitForFunction(() => {
      const state = window.__sheets.views[0].getState()
      return state.sheets.find((sheet) => sheet.id === state.sheetId).name === 'Ledger'
    })
  })

  await step('the status bar sums the selection and offers the other figures', async () => {
    await go(ui, 'C2:C5')
    await summaryIs('Sum: 10')
    await editor.locator('[data-sheet-summary]').click()
    await ui.getByRole('menuitemradio', { name: 'Max: 4' }).click()
    await summaryIs('Max: 4')
    assert.equal(await ui.evaluate(() => localStorage.getItem('pulpo:sheets:status-aggregate')), 'max')
    await gridFocused()
    await go(ui, 'A2:A5')
    // Text has no maximum: the count shows instead.
    await summaryIs('Count: 4')
  })

  await step('Data ▸ Data validation creates a dropdown that then lists and rejects', async () => {
    await go(ui, 'E2:E5')
    await menuPath('Data', 'Data validation…')
    const dialog = ui.getByRole('dialog', { name: 'Data validation' })
    await dialog.getByLabel('Items, one per line').fill('Open\nDone')
    await dialog.getByLabel('Reject the input').check()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await dialog.waitFor({ state: 'detached' })
    await gridFocused()
    await go(ui, 'E3')
    await ui.keyboard.press('Alt+ArrowDown')
    const list = editor.locator('.pulpo-sheet-popup[role="listbox"]')
    await list.waitFor()
    await ui.keyboard.press('ArrowDown')
    await ui.keyboard.press('Enter')
    assert.equal(await inputText(ui, 2, 4), 'Done')
    await ui.keyboard.type('Maybe')
    await ui.keyboard.press('Enter')
    await editor.getByRole('alert').waitFor()
    await ui.keyboard.press('Escape')
    assert.equal(await inputText(ui, 2, 4), 'Done')
  })

  await step('Format ▸ Conditional formatting colors the cells a preset matches', async () => {
    await go(ui, 'B2:B5')
    await menuPath('Format', 'Conditional formatting…')
    const dialog = ui.getByRole('dialog', { name: 'Conditional formatting' })
    await dialog.getByLabel('Value', { exact: true }).fill('15')
    await dialog.getByText('Green fill with dark green text').click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await dialog.waitFor({ state: 'detached' })
    await gridFocused()
    const fills = await ui.evaluate(() => [1, 2, 3, 4].map((row) => window.__sheets.views[0].cellRender(row, 1).overlay?.style?.fill?.rgb ?? null))
    assert.deepEqual(fills, ['FFC6EFCE', null, 'FFC6EFCE', null])
  })

  await step('Format ▸ Number ▸ Custom number format previews and applies', async () => {
    await go(ui, 'C2')
    await menuPath('Format', 'Number', 'Custom number format…')
    const dialog = ui.getByRole('dialog', { name: 'Custom number format' })
    await dialog.getByLabel('Format code').fill('0.0" units"')
    assert.match(await dialog.locator('[data-number-format-preview]').textContent(), /3\.0 units/)
    await dialog.getByLabel('Format code').press('Enter')
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await shown(ui, 1, 2), '3.0 units')
    await gridFocused()
  })

  await step('Ctrl+K links a cell to a place in the workbook, and Ctrl+click follows it', async () => {
    await go(ui, 'A8')
    await ui.keyboard.press(`${mod}+k`)
    const dialog = ui.getByRole('dialog', { name: 'Insert link' })
    await dialog.getByLabel('Text to display').fill('Go to sales')
    await dialog.getByLabel('Link', { exact: true }).fill('ledger!b2')
    await dialog.getByLabel('Link', { exact: true }).press('Enter')
    await dialog.waitFor({ state: 'detached' })
    await gridFocused()
    assert.equal(await inputText(ui, 7, 0), 'Go to sales')
    assert.equal((await sheetState()).activeLink?.location, 'Ledger!B2')
    const a8 = await cellPoint(ui, 7, 0)
    await ui.keyboard.down(mod)
    await ui.mouse.click(a8.x, a8.y)
    await ui.keyboard.up(mod)
    await ui.waitForFunction(() => window.__sheets.views[0].getState().selectionLabel === 'B2')
  })

  await step('Data ▸ Sort range ▸ Advanced options keep the header row and undo once', async () => {
    await go(ui, 'A1:C5')
    await menuPath('Data', 'Sort range', 'Advanced range sorting options…')
    const dialog = ui.getByRole('dialog', { name: /Sort range from A1:C5/ })
    assert.equal(await dialog.getByLabel('Data has header row').isChecked(), true)
    await dialog.getByRole('combobox', { name: 'Sort by' }).click()
    await ui.getByRole('option', { name: 'Sales' }).click()
    await dialog.getByLabel('Z → A').check()
    await dialog.getByRole('button', { name: 'Sort', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    const column = () => Promise.all([0, 1, 2, 3, 4].map((row) => inputText(ui, row, 0)))
    assert.deepEqual(await column(), ['Region', 'North', 'East', 'south', 'West'])
    await gridFocused()
    await ui.keyboard.press(`${mod}+z`)
    assert.deepEqual(await column(), ['Region', 'North', 'south', 'East', 'West'])
  })

  await step('a value breaking a warning rule asks "Continue?": No keeps editing, Yes enters it', async () => {
    await ui.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('F2:F3')
      view.setValidation({ type: 'whole', operator: 'between', formula1: '1', formula2: '10', errorStyle: 'warning', showErrorMessage: true, error: 'Pick 1 to 10' })
    })
    await go(ui, 'F2')
    await ui.keyboard.type('42')
    await ui.keyboard.press('Enter')
    const prompt = ui.getByRole('alertdialog', { name: 'Invalid data' })
    await prompt.getByText('Pick 1 to 10').waitFor()
    await prompt.getByRole('button', { name: 'No' }).click()
    await prompt.waitFor({ state: 'detached' })
    await gridFocused()
    assert.equal(await ui.evaluate(() => window.__sheets.views[0].editing?.text), '42')
    await ui.keyboard.press('Enter')
    await prompt.getByRole('button', { name: 'Yes' }).click()
    // The answer goes to the grid once the prompt has closed and handed the focus back.
    await ui.waitForFunction(() => window.__sheets.views[0].inputText(1, 5) === '42')
    assert.equal((await sheetState()).selectionLabel, 'F3')
    await gridFocused()
  })

  await step('Ctrl+G goes to the name box, Ctrl+Alt+- offers rows or columns, View ▸ Show hides gridlines', async () => {
    await go(ui, 'B2')
    await ui.keyboard.press(`${mod}+g`)
    await ui.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Name box')
    await ui.keyboard.type('C4')
    await ui.keyboard.press('Enter')
    assert.equal((await sheetState()).selectionLabel, 'C4')
    await ui.evaluate(() => {
      const view = window.__sheets.views[0]
      view.goTo('H1')
      view.clipboard.paste({ text: 'gone\tgone too\tkeep' })
    })
    await go(ui, 'H1:I1')
    await ui.keyboard.press(`${mod}+Alt+Minus`)
    const dialog = ui.getByRole('dialog', { name: 'Delete' })
    await dialog.getByLabel('Delete columns H–I').check()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await inputText(ui, 0, 7), 'keep')
    assert.equal(await inputText(ui, 1, 0), 'North')
    await gridFocused()
    await bar.getByRole('menuitem', { name: 'View', exact: true }).click()
    await openSubmenu('Show')
    await ui.getByRole('menuitemcheckbox', { name: 'Gridlines' }).click()
    assert.equal((await sheetState()).showGridLines, false)
    await gridFocused()
    await ui.keyboard.press(`${mod}+z`)
    assert.equal((await sheetState()).showGridLines, true)
  })

  assert.deepEqual(uiErrors, [])
  await uiContext.close()

  await step('conditional formatting tabs and sort columns stay usable on a phone', async () => {
    const { page: phone, errors: phoneErrors, context } = await open('?lang=es', { viewport: { width: 360, height: 740 } })
    await phone.evaluate(() => window.__sheets.views[0].goTo('B4:D12'))
    const phoneBar = phone.getByRole('menubar')
    await phoneBar.getByRole('menuitem', { name: 'Formato', exact: true }).click()
    await phone.getByRole('menuitem', { name: /^Formato condicional/ }).click()
    const tabs = await phone.locator('[data-sheet-conditional-dialog] [role="tablist"]').evaluate((list) => {
      const bounds = list.getBoundingClientRect()
      return [...list.querySelectorAll('[role="tab"]')].map((tab) => {
        const box = tab.getBoundingClientRect()
        return { name: tab.textContent, inside: box.left >= bounds.left - 0.5 && box.right <= bounds.right + 0.5 }
      })
    })
    assert.deepEqual(tabs.filter((tab) => !tab.inside), [], 'every tab shows in full: none is cut off or scrolled away')
    await phone.keyboard.press('Escape')
    await phone.getByRole('dialog').waitFor({ state: 'detached' })
    await phoneBar.getByRole('menuitem', { name: 'Datos', exact: true }).click()
    await phone.getByRole('menuitem', { name: /^Ordenar intervalo/ }).hover()
    await phone.keyboard.press('ArrowRight')
    await phone.locator('[data-menu-item="sort-range-advanced"]').press('Enter')
    const dialog = phone.locator('[data-sheet-sort-dialog]')
    await dialog.getByRole('button', { name: 'Añadir otra columna de ordenación' }).click()
    const widths = await dialog.getByRole('combobox').evaluateAll((list) => list.map((select) => select.getBoundingClientRect().width))
    assert.equal(widths.length, 2)
    for (const width of widths) assert.ok(width >= 150, `a sort column's name has room (${width}px)`)
    assert.deepEqual(phoneErrors, [])
    await context.close()
  })

  for (const line of results) console.log(line)
  console.log('spreadsheet editor works in the browser')
} finally {
  await browser?.close()
  await server?.close()
}
