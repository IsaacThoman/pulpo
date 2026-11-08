// Run with: npm run test:live-editors -w @pulpo/web (build @pulpo/client-core first)
// Install the browser once with: npx playwright install chromium
//
// Drives the notebook and text editors in their server-free harness (tests/live-editors) like a
// user: find and replace (notebook-wide and in text), go to line, word counts, menus that give
// the keyboard back, Jupyter, VS Code and Colab keys, the cell clipboard, hidden code and outputs,
// line numbers, the outline, long outputs, and two collaborators. PULPO_SCREENSHOTS=<dir> saves
// screenshots.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
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
  // A chosen menu item closes its menu with an animation; keys pressed meanwhile still go to the menu.
  // Radix then hands the keyboard back (onCloseAutoFocus) a task after the menu has gone, so keys
  // pressed as soon as it detaches land on the page: wait until the editor has the keyboard again.
  const menuClosed = async (page) => {
    await page.getByRole('menu').waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.activeElement?.closest('[data-replica="a"]') != null)
  }
  const focused = (page) => page.evaluate(() => {
    const element = document.activeElement
    return { tag: element?.tagName, name: element?.getAttribute('name'), label: element?.getAttribute('aria-label'), role: element?.getAttribute('role'), editor: Boolean(element?.closest('.cm-editor')) }
  })
  // The menu bar's menus (File, Edit, View…), opened by their names as a mouse user would.
  const openMenu = async (page, name) => {
    await page.locator('[data-replica="a"]').getByRole('menubar', { name: 'Menu bar' }).getByRole('menuitem', { name, exact: true }).click()
    return page.getByRole('menu').last()
  }
  // A download the page starts, read back as text.
  const downloaded = async (page, start) => {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), start()])
    return { name: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf8') }
  }
  const editorFontSize = (page) => page.locator('[data-replica="a"] .cm-editor').evaluate((element) => getComputedStyle(element).fontSize)

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
    await menuClosed(page)
    await page.keyboard.type('x')
    assert.ok((await page.evaluate(() => window.harness.text())).endsWith('x'), 'typing reaches the document')
    await page.context().close()
  })

  await step('text: View ▸ Line numbers toggles the gutter, Alt+Z wraps, and View ▸ Zoom sizes the text', async () => {
    const { page, errors } = await openText()
    const gutter = page.locator('[data-replica="a"] .cm-lineNumbers')
    await gutter.waitFor()
    await openMenu(page, 'View')
    await shot(page, 'text-view-menu')
    await page.getByRole('menuitemcheckbox', { name: /Line numbers/ }).click()
    await menuClosed(page)
    await gutter.waitFor({ state: 'detached' })
    assert.equal((await focused(page)).editor, true, 'the menu gives the keyboard back to the text')
    await openMenu(page, 'View')
    await page.getByRole('menuitemcheckbox', { name: /Line numbers/ }).click()
    await menuClosed(page)
    await gutter.waitFor()
    // Alt+Z (VS Code) toggles wrapping without typing a character.
    const before = await page.evaluate(() => window.harness.text())
    await page.keyboard.press('Alt+z')
    await page.locator('[data-replica="a"] .cm-lineWrapping').waitFor()
    await page.keyboard.press('Alt+z')
    await page.locator('[data-replica="a"] .cm-lineWrapping').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.harness.text()), before)
    // Zoom is this person's: the font grows, the status bar says so, and a click there resets it.
    assert.equal(await editorFontSize(page), '13px')
    await openMenu(page, 'View')
    await page.getByRole('menuitem', { name: 'Zoom' }).click()
    await page.getByRole('menuitemradio', { name: '150%' }).click()
    await menuClosed(page)
    assert.equal(await editorFontSize(page), '19.5px')
    const zoom = page.locator('[data-replica="a"] [data-text-zoom]')
    assert.equal(await zoom.innerText(), '150%')
    assert.equal(await page.evaluate(() => localStorage.getItem('pulpo:text-editor:zoom')), '1.5')
    await zoom.click()
    await zoom.waitFor({ state: 'detached' })
    assert.equal(await editorFontSize(page), '13px')
    assert.deepEqual(errors, [])
    await page.context().close()
  })

  await step('text: Edit ▸ Go to line, Tools ▸ Word count, and indentation from the menu', async () => {
    const { page } = await openText()
    await openMenu(page, 'Edit')
    await shot(page, 'text-edit-menu')
    await page.getByRole('menuitem', { name: /Go to line/ }).click()
    const line = page.locator('.cm-goto-line input')
    await line.waitFor()
    await page.waitForFunction(() => document.activeElement?.closest('.cm-goto-line') != null)
    await line.fill('4:3')
    await page.keyboard.press('Enter')
    await page.getByText('Ln 4, Col 3').waitFor()
    assert.equal((await focused(page)).editor, true)
    await openMenu(page, 'Tools')
    await page.getByRole('menuitem', { name: /Word count/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Word count' })
    await dialog.waitFor()
    assert.match((await dialog.locator('tbody tr').first().innerText()).replace(/\s+/g, ' '), /^Words 17$/)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.activeElement?.closest('.cm-editor'), null, { timeout: 2_000 })
    await openMenu(page, 'Edit')
    await page.getByRole('menuitem', { name: 'Indentation' }).click()
    await page.getByRole('menuitemradio', { name: 'Tab width 4' }).click()
    await menuClosed(page)
    await page.getByRole('button', { name: 'Indentation' }).getByText('Tabs: 4').waitFor()
    await page.context().close()
  })

  await step('text: Edit ▸ Select all, Copy, Paste, Cut, and Toggle line comment', async () => {
    const { page } = await openText('name=main.py&text=x%20%3D%201%0A')
    const text = () => page.evaluate(() => window.harness.text())
    await openMenu(page, 'Edit')
    await page.getByRole('menuitem', { name: /Toggle line comment/ }).waitFor()
    await page.waitForFunction(() => document.querySelector('[data-menu-item="toggle-comment"]')?.getAttribute('aria-disabled') !== 'true')
    await page.getByRole('menuitem', { name: /Toggle line comment/ }).click()
    await menuClosed(page)
    assert.equal(await text(), '# x = 1\n')
    await openMenu(page, 'Edit')
    await page.getByRole('menuitem', { name: /Select all/ }).click()
    await menuClosed(page)
    await openMenu(page, 'Edit')
    await page.getByRole('menuitem', { name: /^Copy/ }).click()
    await menuClosed(page)
    await page.waitForFunction(async () => (await navigator.clipboard.readText()) === '# x = 1\n')
    await page.keyboard.press(`${mod}+End`)
    await openMenu(page, 'Edit')
    await page.getByRole('menuitem', { name: /^Paste/ }).click()
    await menuClosed(page)
    await page.waitForFunction(() => window.harness.text() === '# x = 1\n# x = 1\n')
    await page.keyboard.press(`${mod}+z`)
    await page.waitForFunction(() => window.harness.text() === '# x = 1\n')
    await openMenu(page, 'Edit')
    await page.getByRole('menuitem', { name: /Select all/ }).click()
    await menuClosed(page)
    await openMenu(page, 'Edit')
    await page.getByRole('menuitem', { name: /^Cut/ }).click()
    await menuClosed(page)
    await page.waitForFunction(() => window.harness.text() === '')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '# x = 1\n')
    // The browser's clipboard outlives the page: leave it empty for the steps after.
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await page.context().close()
    // Plain text has no comments, so Edit offers none.
    const notes = await openText()
    await openMenu(notes.page, 'Edit')
    await notes.page.getByRole('menuitem', { name: /Go to line/ }).waitFor()
    assert.equal(await notes.page.getByRole('menuitem', { name: /Toggle line comment/ }).count(), 0)
    await notes.page.context().close()
  })

  await step('text: spell check is on for notes, off for code, and View ▸ Spell check turns it on', async () => {
    const notes = await openText()
    assert.equal(await notes.page.locator('[data-replica="a"] .cm-content').getAttribute('spellcheck'), 'true')
    await notes.page.context().close()
    const { page } = await openText('name=main.py&text=print(1)%0A')
    const content = page.locator('[data-replica="a"] .cm-content')
    assert.equal(await content.getAttribute('spellcheck'), 'false')
    await openMenu(page, 'View')
    await page.getByRole('menuitemcheckbox', { name: /Spell check/ }).click()
    await menuClosed(page)
    assert.equal(await content.getAttribute('spellcheck'), 'true')
    await page.context().close()
  })

  // Notebook editor

  await step('notebook: File ▸ Download saves a Python script and a static web page', async () => {
    const { page, errors } = await openNotebook()
    await openMenu(page, 'File')
    await page.getByRole('menuitem', { name: 'Download' }).click()
    await shot(page, 'notebook-file-download')
    const script = await downloaded(page, () => page.getByRole('menuitem', { name: 'Python (.py)' }).click())
    assert.equal(script.name, 'generated-analysis.py')
    assert.equal(script.text, await page.evaluate(() => window.harness.script()))
    assert.match(script.text, /^# %% \[markdown\]\n# # Sales analysis/m)
    assert.match(script.text, /^# %%\n# %matplotlib inline/m)
    await menuClosed(page)
    await openMenu(page, 'File')
    await page.getByRole('menuitem', { name: 'Download' }).click()
    const html = await downloaded(page, () => page.getByRole('menuitem', { name: 'Web page (.html)' }).click())
    assert.equal(html.name, 'generated-analysis.html')
    assert.match(html.text, /^<!doctype html>/i)
    assert.match(html.text, /Sales analysis/)
    assert.doesNotMatch(html.text, /<script/i, 'the page runs nothing')
    assert.deepEqual(errors, [])
    await page.context().close()
  })

  await step('notebook: View ▸ Table of contents, Insert ▸ Markdown cell below, and Insert ▸ Heading', async () => {
    const { page } = await openNotebook()
    await notebookList(page).focus()
    const outline = page.locator('[data-replica="a"] [data-notebook-outline]')
    await openMenu(page, 'View')
    await shot(page, 'notebook-view-menu')
    await page.getByRole('menuitemcheckbox', { name: /Table of contents/ }).click()
    await menuClosed(page)
    await outline.waitFor()
    assert.equal((await focused(page)).role, 'list', 'the keyboard is back on the cells')
    await openMenu(page, 'View')
    await page.getByRole('menuitemcheckbox', { name: /Table of contents/ }).click()
    await menuClosed(page)
    await outline.waitFor({ state: 'detached' })
    const count = (await cells(page)).length
    await openMenu(page, 'Insert')
    await shot(page, 'notebook-insert-menu')
    await page.getByRole('menuitem', { name: 'Markdown cell below' }).click()
    await menuClosed(page)
    await page.waitForFunction((expected) => window.harness.cells().length === expected, count + 1)
    assert.equal((await cells(page))[1].type, 'markdown')
    assert.equal(await active(page).getAttribute('data-mode'), 'edit')
    await page.keyboard.type('Notes')
    assert.equal((await cells(page))[1].source, 'Notes')
    await openMenu(page, 'Insert')
    await page.getByRole('menuitem', { name: 'Heading', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Heading 2' }).click()
    await menuClosed(page)
    await page.keyboard.type('Results')
    assert.deepEqual((await cells(page)).slice(1, 3).map((cell) => [cell.type, cell.source]), [['markdown', 'Notes'], ['markdown', '## Results']])
    await page.context().close()
  })

  await step('notebook: Cell ▸ type and move, and Edit ▸ Clear all outputs, one undo step each', async () => {
    const { page } = await openNotebook()
    await notebookList(page).focus()
    await page.keyboard.press('j')
    const before = await cells(page)
    await openMenu(page, 'Cell')
    await shot(page, 'notebook-cell-menu')
    await page.getByRole('menuitem', { name: /Move cell down/ }).click()
    await menuClosed(page)
    assert.deepEqual((await cells(page)).slice(1, 3).map((cell) => cell.key), [before[2].key, before[1].key])
    await openMenu(page, 'Cell')
    await page.getByRole('menuitem', { name: 'Cell type' }).click()
    await page.getByRole('menuitemradio', { name: /Raw/ }).click()
    await menuClosed(page)
    assert.equal((await cells(page))[2].type, 'raw')
    await page.keyboard.press('z')
    await page.keyboard.press('z')
    assert.deepEqual((await cells(page)).map((cell) => cell.key), before.map((cell) => cell.key))
    await openMenu(page, 'Edit')
    await page.getByRole('menuitem', { name: 'Clear all outputs' }).click()
    await menuClosed(page)
    await page.locator('[data-replica="a"] [data-cell-outputs]').first().waitFor({ state: 'detached' })
    await page.keyboard.press('z')
    await page.locator('[data-replica="a"] [data-cell-outputs]').first().waitFor()
    await page.context().close()
  })

  await step('notebook: a cell\'s context menu duplicates, moves, and keeps the selection', async () => {
    const { page, errors } = await openNotebook()
    await notebookList(page).focus()
    const cellAt = (index) => page.locator('[data-replica="a"] [data-cell-key]').nth(index)
    const menu = page.getByRole('menu', { name: 'Cell actions' })
    // Right-click the cell's prompt (its chrome): the cell's menu, not the browser's.
    await cellAt(2).click({ button: 'right', position: { x: 20, y: 12 } })
    await menu.waitFor()
    await shot(page, 'notebook-cell-context-menu')
    assert.equal(await active(page).getAttribute('data-cell-key'), (await cells(page))[2].key, 'the right-clicked cell is selected')
    const before = await cells(page)
    await menu.getByRole('menuitem', { name: /Duplicate cell/ }).click()
    await menuClosed(page)
    const duplicated = await cells(page)
    assert.equal(duplicated.length, before.length + 1)
    assert.equal(duplicated[3].source, before[2].source)
    assert.equal((await focused(page)).role, 'list', 'the menu gives the keyboard back to the cells')
    await cellAt(3).click({ button: 'right', position: { x: 20, y: 12 } })
    await menu.getByRole('menuitem', { name: /Move cell up/ }).click()
    await menuClosed(page)
    assert.equal((await cells(page))[2].key, duplicated[3].key)
    // With two cells selected, right-clicking one of them keeps both, and Delete acts on both.
    await page.keyboard.press('Shift+j')
    await page.locator('[data-replica="a"]').getByText('2 cells selected').waitFor()
    await cellAt(2).click({ button: 'right', position: { x: 20, y: 12 } })
    await menu.waitFor()
    await page.locator('[data-replica="a"]').getByText('2 cells selected').waitFor()
    await menu.getByRole('menuitem', { name: 'Delete cells' }).click()
    await menuClosed(page)
    assert.equal((await cells(page)).length, duplicated.length - 2)
    // Shift+F10 opens the active cell's menu from the keyboard; Escape gives the keyboard back.
    await page.keyboard.press('Shift+F10')
    await menu.waitFor()
    await page.keyboard.press('Escape')
    await menuClosed(page)
    assert.equal((await focused(page)).role, 'list')
    // In a cell's code, the browser's own menu stays (spelling, Copy, Paste).
    await cellAt(1).locator('.cm-content').click({ button: 'right' })
    await page.waitForTimeout(150)
    assert.equal(await menu.count(), 0)
    assert.deepEqual(errors, [])
    await page.context().close()
  })

  await step('notebook: Cmd/Ctrl+B, I, and K format a Markdown cell and are not left to the app', async () => {
    const { page } = await openNotebook('blank=1')
    // The app's sidebar key listens on the window and skips keys an editor handled.
    await page.evaluate(() => {
      window.formatKeys = []
      window.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'k'].includes(event.key)) window.formatKeys.push([event.key, event.defaultPrevented])
      })
    })
    await notebookList(page).focus()
    await page.keyboard.press('m')
    await page.keyboard.press('Enter')
    await page.keyboard.type('make this bold')
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press(`${mod}+b`)
    await page.keyboard.press(`${mod}+i`)
    await page.keyboard.press(`${mod}+k`)
    await page.keyboard.type('https://example.com')
    assert.equal((await cells(page))[0].source, 'make this ***[bold](https://example.com)***')
    assert.deepEqual(await page.evaluate(() => window.formatKeys), [['b', true], ['i', true], ['k', true]])
    // In a code cell Cmd/Ctrl+B is the app's again (its sidebar), as in VS Code.
    await page.keyboard.press('Escape')
    await page.keyboard.press('b')
    await page.keyboard.press('Enter')
    await page.keyboard.type('x')
    await page.keyboard.press(`${mod}+b`)
    assert.deepEqual((await page.evaluate(() => window.formatKeys)).at(-1), ['b', false])
    assert.equal((await cells(page))[1].source, 'x')
    await page.context().close()
  })

  await step('notebook: Runtime ▸ Run all with agent shows only where an agent can run the notebook', async () => {
    const { page } = await openNotebook()
    assert.equal(await page.locator('[data-replica="a"] [data-menu="runtime"]').count(), 0)
    await page.context().close()
    const runs = await openNotebook('agent=1')
    await openMenu(runs.page, 'Runtime')
    await runs.page.getByRole('menuitem', { name: 'Run all with agent' }).click()
    assert.equal(await runs.page.evaluate(() => window.agentRuns), 1)
    await runs.page.context().close()
  })

  await step('notebook: Help ▸ Keyboard shortcuts lists the Markdown keys, and cell letters only outside edit mode', async () => {
    const { page } = await openNotebook()
    await notebookList(page).focus()
    await openMenu(page, 'Help')
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await dialog.waitFor()
    const section = (name) => dialog.getByRole('region', { name, exact: true })
    assert.match(await section('Markdown cells (while editing)').innerText(), /Bold[\s\S]*Italic[\s\S]*Insert link/)
    // X, C, and V type letters while a cell is edited: the Edit menu's cell clipboard is listed under Edit.
    assert.doesNotMatch(await section('Edit mode').innerText(), /Cut cells|Copy cells|Paste cells/)
    assert.match(await section('Edit').innerText(), /Cut cells[\s\S]*Copy cells/)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.equal((await focused(page)).role, 'list')
    await page.context().close()
  })

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
    // F3 from a cell, and again once stepping to another cell has left the keyboard on the cell list.
    await page.locator('[data-replica="a"] [data-cell="code"] .cm-content').first().click()
    await page.keyboard.press('F3')
    await page.keyboard.press('F3')
    await page.keyboard.press('Shift+F3')
    await status.getByText(new RegExp(`^\\d+ of ${total}$`)).waitFor()
    const stepped = Number((await status.innerText()).split(' of ')[0])
    await page.keyboard.press('F3')
    await status.getByText(`${stepped % total + 1} of ${total}`).waitFor()
    await field.click()
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
    await menuClosed(page)
    await page.keyboard.press('b')
    assert.equal((await cells(page)).length, count + 1, 'B inserts a cell right after choosing from the menu')
    await page.keyboard.press('d')
    await page.keyboard.press('d')
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitemcheckbox', { name: /Line numbers/ }).click()
    await menuClosed(page)
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
    await menuClosed(page)
    await plot.getByRole('button', { name: 'Source hidden' }).waitFor()
    assert.equal((await cells(page))[3].sourceHidden, true)
    assert.equal((await focused(page)).role, 'list', 'the menu gives the keyboard back')
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'Collapse all outputs' }).click()
    await menuClosed(page)
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
    // Ctrl+M M with Ctrl still held makes Markdown, as Ctrl+M Ctrl+B would insert.
    await page.keyboard.down('Control')
    await page.keyboard.press('m')
    await page.keyboard.press('m')
    await page.keyboard.up('Control')
    assert.equal((await cells(page))[1].type, 'markdown')
    await page.keyboard.press('Control+m')
    await page.keyboard.press('y')
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
    await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor()
    await page.keyboard.press('Escape')
    await page.context().close()
  })

  await step('notebook: Ctrl+C and Ctrl+V copy cells, and pasted text becomes a cell', async () => {
    const { page } = await openNotebook()
    await notebookList(page).focus()
    const count = (await cells(page)).length
    await page.keyboard.press(`${mod}+c`)
    // The copy reaches the system clipboard asynchronously; paste once it has.
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith('# Sales analysis'))
    await page.keyboard.press(`${mod}+v`)
    await page.waitForFunction((expected) => window.harness.cells().length === expected, count + 1)
    const copied = await cells(page)
    assert.equal(copied[1].source, copied[0].source)
    await page.evaluate(() => navigator.clipboard.writeText('print("pasted from elsewhere")'))
    await page.keyboard.press(`${mod}+v`)
    await page.waitForFunction((expected) => window.harness.cells().length === expected, count + 2)
    assert.equal((await cells(page))[2].source, 'print("pasted from elsewhere")')
    assert.equal((await cells(page))[2].type, 'code')
    // Text selected in an output copies as text, as anywhere on a page; no cells are copied.
    const stream = page.locator('[data-replica="a"] [data-output="stream"]').first()
    await stream.click({ clickCount: 3 })
    const selected = await page.evaluate(() => String(window.getSelection()))
    assert.ok(selected.trim(), 'output text is selected')
    assert.equal((await focused(page)).role, 'list', 'the cell list has the keyboard')
    await page.keyboard.press(`${mod}+c`)
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), selected)
    assert.equal((await cells(page)).length, count + 2)
    // Text left selected in a cell's editor after Escape does not count: Ctrl+X cuts the cell.
    await page.locator('[data-replica="a"] [data-cell="code"]').first().locator('.cm-content').click()
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Escape')
    assert.ok((await page.evaluate(() => String(window.getSelection()))).trim(), 'the editor\'s text stays selected')
    await page.keyboard.press(`${mod}+x`)
    await page.waitForFunction((expected) => window.harness.cells().length === expected, count + 1)
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
    // View ▸ Scroll long outputs shows the selected cell's state, and turns scrolling back on.
    await openMenu(page, 'View')
    const item = page.getByRole('menuitemcheckbox', { name: /Scroll long outputs/ })
    assert.equal(await item.getAttribute('aria-checked'), 'false')
    await item.click()
    await menuClosed(page)
    await scroller.waitFor()
    await openMenu(page, 'View')
    assert.equal(await item.getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Escape')
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
