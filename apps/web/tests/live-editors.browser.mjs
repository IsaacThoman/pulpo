// Run with: npm run test:live-editors -w @pulpo/web (build @pulpo/client-core first)
// Install the browser once with: npx playwright install chromium
//
// Drives the notebook and text editors in their server-free harness (tests/live-editors) like a
// user: find and replace (notebook-wide and in text), go to line, word counts, menus that give
// the keyboard back, Jupyter, VS Code and Colab keys, the cell clipboard, hidden code and outputs,
// line numbers, the outline, long outputs, and two collaborators. PULPO_SCREENSHOTS=<dir> saves
// screenshots.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const screenshots = process.env.PULPO_SCREENSHOTS
if (screenshots) mkdirSync(screenshots, { recursive: true })
let server
let browser
const results = []

async function step(name, run) {
  // ONLY=<text> runs the steps whose name contains it.
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  console.log(`… ${name}`)
  const started = performance.now()
  await run()
  results.push(`ok ${name} (${Math.round(performance.now() - started)}ms)`)
}

try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { include: ['yjs', 'y-protocols/awareness'] } })
  await server.listen()
  const base = `${server.resolvedUrls.local[0]}tests/live-editors/index.html`
  browser = await chromium.launch()

  const open = async (query = '', options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], ...options })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}?${query}`)
    await page.waitForFunction(() => window.harness)
    return { page, errors, context }
  }
  const openNotebook = async (query = '') => {
    const opened = await open(query)
    await opened.page.locator('[data-replica="a"] [data-notebook-editor]').waitFor()
    await opened.page.locator('[data-replica="a"] [data-cell-key]').first().waitFor()
    return opened
  }
  const openText = async (query = '') => {
    const opened = await open(`format=text&${query}`)
    await opened.page.locator('[data-replica="a"] .cm-content').waitFor()
    return opened
  }
  const cells = (page, which = 'a') => page.evaluate((replica) => window.harness.cells(replica), which)
  const notebookList = (page) => page.locator('[data-replica="a"]').getByRole('list', { name: 'Notebook cells' })
  const active = (page) => page.locator('[data-replica="a"] [data-cell-key][data-active]')
  const shot = async (page, name) => { if (screenshots) await page.screenshot({ path: join(screenshots, `${name}.png`) }) }
  const focused = (page) => page.evaluate(() => {
    const element = document.activeElement
    return { tag: element?.tagName, name: element?.getAttribute('name'), label: element?.getAttribute('aria-label'), role: element?.getAttribute('role'), editor: Boolean(element?.closest('.cm-editor')) }
  })

  // Text editor

  await step('text: the Find button leaves the caret in the find field', async () => {
    const { page, errors } = await openText()
    const before = await page.evaluate(() => window.harness.text())
    await page.getByRole('button', { name: 'Find and replace' }).click()
    await page.keyboard.type('fox')
    assert.equal(await page.locator('.cm-search input[name=search]').inputValue(), 'fox')
    assert.equal(await page.evaluate(() => window.harness.text()), before, 'nothing was typed into the document')
    await page.keyboard.press('Escape')
    assert.equal((await focused(page)).editor, true, 'Escape returns to the text')
    assert.deepEqual(errors, [])
    await page.context().close()
  })

  await step('text: a freshly opened file takes Ctrl+F, and Ctrl+H opens replace', async () => {
    const { page } = await openText()
    assert.equal((await focused(page)).editor, true, 'the opened file has the keyboard')
    await page.keyboard.press(`${mod}+f`)
    await page.locator('.cm-search input[name=search]').waitFor()
    assert.equal((await focused(page)).name, 'search')
    await page.keyboard.type('fox')
    await page.keyboard.press('Escape')
    // Replace goes to the replace field once there is something to find (as in VS Code).
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+f' : 'Control+h')
    assert.equal((await focused(page)).name, 'replace')
    await page.keyboard.press('Escape')
    // From the toolbar too (keyboard users tab there).
    await page.getByRole('button', { name: 'Wrap lines' }).focus()
    await page.keyboard.press(`${mod}+f`)
    assert.equal((await focused(page)).name, 'search')
    await page.context().close()
  })

  await step('text: Ctrl+G and the status bar go to a line and column', async () => {
    const { page } = await openText()
    await page.keyboard.press('Control+g')
    await page.locator('.cm-goto-line input').fill('2:6')
    await page.keyboard.press('Enter')
    await page.getByText('Ln 2, Col 6').waitFor()
    assert.equal((await focused(page)).editor, true)
    await page.locator('[data-text-position]').click()
    await page.locator('.cm-goto-line input').fill('4')
    await page.keyboard.press('Enter')
    await page.getByText('Ln 4, Col 1').waitFor()
    await page.context().close()
  })

  await step('text: lines, words, selections, and the Word count dialog', async () => {
    const { page } = await openText()
    const status = page.locator('[data-text-counts]')
    await status.getByText('17 words').waitFor()
    await status.getByText('5 lines').waitFor()
    await page.keyboard.press(`${mod}+Home`)
    await page.keyboard.press('Shift+End')
    await status.getByText('4 of 17 words').waitFor()
    await status.click()
    const dialog = page.getByRole('dialog', { name: 'Word count' })
    await dialog.waitFor()
    const rows = await dialog.locator('tbody tr').allInnerTexts()
    assert.deepEqual(rows.map((row) => row.split(/\s+/).join(' ')), ['Words 4 17', 'Characters 19 88', 'Characters excluding spaces 16 74', 'Lines 1 5'])
    await shot(page, 'text-word-count')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    // The dialog hands the keyboard back as it finishes closing.
    await page.waitForFunction(() => document.activeElement?.closest('.cm-editor'), null, { timeout: 2_000 })
    // Code files count words only for a selection.
    const code = await openText('name=main.py&text=print(1)%0A')
    await code.page.locator('[data-text-counts]').getByText('2 lines').waitFor()
    assert.equal(await code.page.locator('[data-text-counts]').getByText(/words/).count(), 0)
    await code.page.context().close()
    await page.context().close()
  })

  await step('text: the indent menu gives the keyboard back to the text', async () => {
    const { page } = await openText()
    await page.keyboard.press(`${mod}+End`)
    await page.getByRole('button', { name: 'Indentation' }).click()
    await page.getByRole('menuitem', { name: 'Tab width 4' }).click()
    await page.keyboard.type('x')
    assert.ok((await page.evaluate(() => window.harness.text())).endsWith('x'), 'typing reaches the document')
    await page.context().close()
  })

  // Notebook editor

  await step('notebook: find and replace across cells, one undo step each', async () => {
    const { page, errors } = await openNotebook()
    await notebookList(page).focus()
    await page.keyboard.press(`${mod}+f`)
    const field = page.getByRole('textbox', { name: 'Find in notebook' })
    await field.waitFor()
    assert.equal((await focused(page)).label, 'Find in notebook')
    await page.keyboard.type('sales')
    const status = page.locator('[data-notebook-find-status]')
    await status.getByText(/^1 of \d+$/).waitFor()
    const total = Number((await status.innerText()).split(' of ')[1])
    assert.ok(total >= 2, `found ${total}`)
    await page.locator('[data-replica="a"] .cm-searchMatch-selected').first().waitFor()
    await page.keyboard.press('Enter')
    await status.getByText(`2 of ${total}`).waitFor()
    await page.keyboard.press('Shift+Enter')
    await status.getByText(`1 of ${total}`).waitFor()
    await shot(page, 'notebook-find')
    await page.getByRole('button', { name: 'Toggle replace' }).click()
    await page.getByRole('textbox', { name: 'Replace with' }).fill('income')
    const before = await cells(page)
    await page.getByRole('button', { name: 'Replace all' }).click()
    await status.getByText('No matches').waitFor()
    const after = await cells(page)
    assert.ok(after.every((cell) => !/sales/i.test(cell.source)))
    assert.ok(after.some((cell) => cell.source.includes('income')))
    // The other collaborator has it too.
    assert.deepEqual(await cells(page, 'b'), after)
    await page.keyboard.press('Escape')
    await page.getByRole('search').waitFor({ state: 'detached' })
    await page.locator('[data-replica="a"]').getByRole('button', { name: 'Undo' }).click()
    assert.deepEqual(await cells(page), before, 'one undo restores every cell')
    assert.deepEqual(errors, [])
    await page.context().close()
  })

  await step('notebook: Ctrl+F in a cell seeds the bar, and Escape leaves the match selected for typing', async () => {
    const { page } = await openNotebook()
    const code = page.locator('[data-replica="a"] [data-cell="code"] .cm-content').first()
    await code.click()
    await page.keyboard.press(`${mod}+Home`)
    await page.keyboard.press('Shift+End')
    const line = (await cells(page)).find((cell) => cell.type === 'code').source.split('\n')[0]
    await page.keyboard.press(`${mod}+f`)
    const field = page.getByRole('textbox', { name: 'Find in notebook' })
    assert.equal(await field.inputValue(), line)
    await page.keyboard.press('Escape')
    await page.getByRole('search').waitFor({ state: 'detached' })
    assert.equal((await focused(page)).editor, true, 'the cell has the keyboard')
    assert.equal(await active(page).getAttribute('data-mode'), 'edit')
    await page.context().close()
  })

  await step('notebook: menus and placeholders give the keyboard back to the cell list', async () => {
    const { page } = await openNotebook()
    await notebookList(page).focus()
    const count = (await cells(page)).length
    await page.getByRole('button', { name: 'Cell type' }).click()
    await page.getByRole('menuitem', { name: 'Markdown' }).click()
    await page.keyboard.press('b')
    assert.equal((await cells(page)).length, count + 1, 'B inserts a cell right after choosing from the menu')
    await page.keyboard.press('d')
    await page.keyboard.press('d')
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitemcheckbox', { name: /Line numbers/ }).click()
    await page.locator('[data-replica="a"] .cm-lineNumbers').first().waitFor()
    await page.keyboard.press('j')
    await page.keyboard.press('Shift+l')
    await page.locator('[data-replica="a"] .cm-lineNumbers').first().waitFor({ state: 'detached' })
    await page.context().close()
  })

  await step('notebook: hide code and outputs per cell and for all, and viewers reveal them for themselves', async () => {
    const { page } = await openNotebook()
    const plot = page.locator('[data-replica="a"] [data-cell-key]').nth(3)
    await plot.locator('.cm-content').click()
    await page.keyboard.press('Escape')
    await plot.getByRole('button', { name: 'More cell actions' }).click()
    await page.getByRole('menuitem', { name: 'Hide code' }).click()
    await plot.getByRole('button', { name: 'Source hidden' }).waitFor()
    assert.equal((await cells(page))[3].sourceHidden, true)
    assert.equal((await focused(page)).role, 'list', 'the menu gives the keyboard back')
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'Collapse all outputs' }).click()
    const hidden = (await cells(page)).filter((cell) => cell.outputsHidden).length
    assert.ok(hidden >= 2, `${hidden} cells with hidden outputs`)
    await page.locator('[data-replica="a"]').getByRole('button', { name: 'Undo' }).click()
    assert.equal((await cells(page)).filter((cell) => cell.outputsHidden).length, 0, 'one undo expands them all')
    const exported = JSON.parse(await page.evaluate(() => window.harness.exportFile()))
    assert.deepEqual(exported.cells[3].metadata.jupyter, { source_hidden: true })
    await page.context().close()
    // A viewer of a notebook with hidden code opens it locally; the document is unchanged.
    const viewer = await openNotebook('readonly=1')
    await viewer.page.evaluate(() => {
      const cell = [...window.harness.docA.getMap('cells').values()][0]
      cell.get('metadata').set('jupyter', JSON.stringify({ source_hidden: true }))
    })
    const first = viewer.page.locator('[data-replica="a"] [data-cell-key]').first()
    await first.getByRole('button', { name: 'Source hidden' }).click()
    await first.getByRole('button', { name: 'Source hidden' }).waitFor({ state: 'detached' })
    assert.equal((await cells(viewer.page))[0].sourceHidden, true)
    await viewer.page.context().close()
  })

  await step('notebook: Jupyter, VS Code, and Colab keys', async () => {
    const { page } = await openNotebook('blank=1')
    await notebookList(page).focus()
    await page.locator('[data-replica="a"] .cm-content').first().click()
    await page.keyboard.type('Title')
    await page.keyboard.press('Escape')
    await page.keyboard.press('2')
    assert.deepEqual((await cells(page)).map((cell) => [cell.type, cell.source]), [['markdown', '## Title']])
    await page.keyboard.press('z')
    await page.keyboard.press('Shift+z')
    assert.equal((await cells(page))[0].source, '## Title', 'Shift+Z redoes')
    // Colab: Ctrl+M B inserts below, while editing too, without typing the letter.
    await page.keyboard.press('Control+m')
    await page.keyboard.press('b')
    assert.equal((await cells(page)).length, 2)
    await page.keyboard.press('Enter')
    await page.keyboard.type('x = 1')
    await page.keyboard.press('Control+m')
    await page.keyboard.press('a')
    const after = await cells(page)
    assert.deepEqual(after.map((cell) => cell.source), ['## Title', '', 'x = 1'])
    assert.equal(await active(page).getAttribute('data-mode'), 'edit')
    // Tab still indents (Ctrl+M did not switch CodeMirror to tab focus mode).
    await page.keyboard.press('Tab')
    await page.keyboard.type('y')
    assert.equal((await cells(page))[1].source, '    y')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Alt+ArrowDown')
    assert.deepEqual((await cells(page)).map((cell) => cell.source), ['## Title', 'x = 1', '    y'])
    await page.keyboard.press('Shift+Alt+ArrowUp')
    assert.deepEqual((await cells(page)).map((cell) => cell.source), ['## Title', 'x = 1', '    y', '    y'])
    await page.locator('[data-replica="a"]').getByText(/^Cell 3 of 4$/).waitFor()
    await page.keyboard.press('h')
    await page.getByRole('dialog', { name: 'Notebook shortcuts' }).waitFor()
    await page.keyboard.press('Escape')
    await page.context().close()
  })

  await step('notebook: Ctrl+C and Ctrl+V copy cells, and pasted text becomes a cell', async () => {
    const { page } = await openNotebook()
    await notebookList(page).focus()
    const count = (await cells(page)).length
    await page.keyboard.press(`${mod}+c`)
    await page.keyboard.press(`${mod}+v`)
    await page.waitForFunction((expected) => window.harness.cells().length === expected, count + 1)
    const copied = await cells(page)
    assert.equal(copied[1].source, copied[0].source)
    await page.evaluate(() => navigator.clipboard.writeText('print("pasted from elsewhere")'))
    await page.keyboard.press(`${mod}+v`)
    await page.waitForFunction((expected) => window.harness.cells().length === expected, count + 2)
    assert.equal((await cells(page))[2].source, 'print("pasted from elsewhere")')
    assert.equal((await cells(page))[2].type, 'code')
    await page.context().close()
  })

  await step('notebook: the outline lists headings and goes to them', async () => {
    const { page } = await openNotebook('fixture=jupyter-working-with-markdown-cells')
    await page.getByRole('button', { name: 'Table of contents' }).click()
    const outline = page.locator('[data-replica="a"] [data-notebook-outline]')
    await outline.waitFor()
    const entries = await outline.getByRole('button').allInnerTexts()
    assert.ok(entries.length >= 2, `outline: ${entries.join(', ')}`)
    const last = outline.locator('nav button').last()
    await last.click()
    await page.waitForFunction(() => document.querySelector('[data-replica="a"] [data-notebook-outline] nav button:last-child')?.getAttribute('aria-current') === 'location')
    await shot(page, 'notebook-outline')
    // A heading typed in a Markdown cell appears after a moment.
    await page.evaluate(() => {
      const cell = [...window.harness.docA.getMap('cells').values()].find((entry) => entry.get('cell_type') === 'markdown')
      cell.get('source').insert(0, '## Added heading\n')
    })
    await outline.getByRole('button', { name: 'Added heading' }).waitFor()
    await page.context().close()
  })

  await step('notebook: long outputs scroll in their cell, with a toggle', async () => {
    const { page } = await openNotebook('blank=1')
    await page.evaluate(() => {
      const cell = [...window.harness.docA.getMap('cells').values()][0]
      const text = Array.from({ length: 400 }, (_, index) => `epoch ${index}: loss 0.${index}`).join('\n')
      cell.set('outputs', { json: JSON.stringify([{ output_type: 'stream', name: 'stdout', text }]), assets: [] })
    })
    const scroller = page.locator('[data-replica="a"] [data-output-scroll]')
    await scroller.waitFor()
    const height = await scroller.evaluate((element) => element.getBoundingClientRect().height)
    assert.ok(height <= 460, `capped at ${height}px`)
    await page.getByRole('button', { name: 'Show full output' }).click()
    await scroller.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Scroll output' }).waitFor()
    await page.context().close()
  })

  await step('notebook: two collaborators see each other\'s find-and-replace and hidden code', async () => {
    const { page } = await openNotebook('split=1&width=fill')
    const a = page.locator('[data-replica="a"]')
    const b = page.locator('[data-replica="b"]')
    await b.locator('[data-cell-key]').first().waitFor()
    await a.getByRole('list', { name: 'Notebook cells' }).focus()
    await page.keyboard.press(`${mod}+h`)
    await a.getByRole('textbox', { name: 'Find in notebook' }).fill('plt')
    await a.getByRole('textbox', { name: 'Replace with' }).fill('pyplot')
    await a.getByRole('button', { name: 'Replace', exact: true }).click()
    await page.waitForFunction(() => window.harness.cells('b').some((cell) => cell.source.includes('pyplot')))
    assert.deepEqual(await cells(page, 'b'), await cells(page, 'a'))
    await page.context().close()
  })

  console.log(results.join('\n'))
  console.log(`${results.length} steps passed`)
} finally {
  await browser?.close()
  await server?.close()
}
