// Run with: npm run test:editor-chrome -w @pulpo/web (build @pulpo/client-core first)
// Install the browser once with: npx playwright install chromium
// Drives the text and notebook editors' shared chrome in their harness (tests/editor-chrome): the
// menu bar, the keyboard shortcuts dialog, and the print and save keys. Set SCREENSHOT_DIR to also
// save screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const screenshots = process.env.SCREENSHOT_DIR
let server
let browser
const results = []

async function step(name, run) {
  const started = Date.now()
  try {
    await run()
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, { cause: error })
  }
  results.push(`${name} (${Date.now() - started} ms)`)
}

try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  browser = await chromium.launch()

  const open = async (kind) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${server.resolvedUrls.local[0]}tests/editor-chrome/index.html?kind=${kind}`)
    await page.getByRole('menubar', { name: 'Menu bar' }).waitFor()
    // Printing goes through a hidden frame; record what it would print instead of opening a dialog.
    await page.evaluate(() => {
      window.printed = []
      window.print = () => window.printed.push('the page')
      new MutationObserver(() => {
        for (const frame of document.querySelectorAll('iframe[aria-hidden="true"]')) {
          if (frame.dataset.stubbed) continue
          frame.dataset.stubbed = '1'
          frame.contentWindow.print = () => window.printed.push(frame.contentDocument.body.textContent)
        }
      }).observe(document.body, { childList: true })
    })
    return { page, errors, bar: page.getByRole('menubar', { name: 'Menu bar' }) }
  }

  // Alt+/ searches the menus; on a Mac it is Option+/, which types "÷" there: send what a Mac sends.
  const searchMenus = async (page) => {
    if (process.platform !== 'darwin') return page.keyboard.press('Alt+/')
    const cdp = await page.context().newCDPSession(page)
    const key = { modifiers: 1, key: '÷', code: 'Slash', windowsVirtualKeyCode: 191 }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '÷', unmodifiedText: '/', ...key })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
    await cdp.detach()
  }
  // Alt+Shift+F opens the File menu, Ctrl+Option+F on a Mac.
  const fileMenuKey = process.platform === 'darwin' ? 'Control+Alt+f' : 'Alt+Shift+F'

  await step('text: comments code with Cmd/Ctrl+/, toggles wrapping from View, prints the file', async () => {
    const { page, errors, bar } = await open('text')
    await page.locator('.cm-line').first().click()
    // In code, Cmd/Ctrl+/ comments the line out, as in VS Code, rather than opening the list.
    await page.keyboard.press(`${mod}+/`)
    await page.waitForFunction(() => document.querySelector('.cm-content').textContent.startsWith('# def hello'))
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.keyboard.press(`${mod}+z`)
    await page.waitForFunction(() => document.querySelector('.cm-content').textContent.startsWith('def hello'))
    // Find and replace (the menu, and Cmd/Ctrl+F from the toolbar) leaves focus in the search field.
    await bar.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Find and replace' }).click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'search')
    await page.keyboard.type('return')
    assert.equal(await page.locator('.cm-search [name="search"]').inputValue(), 'return')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.activeElement?.closest('.cm-content') !== null)
    await page.getByRole('button', { name: 'Wrap lines' }).focus()
    await page.keyboard.press(`${mod}+f`)
    await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'search')
    await page.keyboard.press('Escape')
    await bar.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Wrap lines' }).click()
    await page.waitForFunction(() => document.querySelector('.cm-lineWrapping') !== null)
    await page.waitForFunction(() => document.activeElement?.closest('.cm-editor') !== null)
    await page.keyboard.press(`${mod}+p`)
    await page.waitForFunction(() => window.printed.length === 1)
    assert.match((await page.evaluate(() => window.printed))[0], /def hello\(\):\n {4}return 1/)
    await page.keyboard.press(`${mod}+s`)
    assert.equal(await page.evaluate(() => window.saved), 1)
    await bar.getByRole('menuitem', { name: 'Help' }).click()
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await dialog.getByText('Comment or uncomment lines').waitFor()
    if (screenshots) await page.screenshot({ path: `${screenshots}/editor-chrome-text-shortcuts.png` })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.activeElement?.closest('.cm-editor') !== null)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await step('notebook: opens the shortcuts in command mode, runs Edit commands, prints the notebook', async () => {
    const { page, errors, bar } = await open('notebook')
    await page.getByRole('list', { name: 'Notebook cells' }).focus()
    await page.keyboard.press(`${mod}+/`)
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await dialog.getByText('Command mode (press Esc)').waitFor()
    await page.keyboard.type('merge')
    await dialog.getByText('Merge the selected cells, or with the cell below').waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    // Keys go back to the cells, so Jupyter's command keys keep working.
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Notebook cells')
    await bar.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Select every cell' }).click()
    await page.getByText('2 cells selected').waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Notebook cells')
    await bar.getByRole('menuitem', { name: 'File' }).click()
    if (screenshots) await page.screenshot({ path: `${screenshots}/editor-chrome-notebook-file.png` })
    await page.getByRole('menuitem', { name: 'Print' }).click()
    await page.waitForFunction(() => window.printed.length === 1, null, { timeout: 10_000 })
    const printed = (await page.evaluate(() => window.printed))[0]
    assert.match(printed, /print\(1\)/)
    assert.match(printed, /Title/)
    await page.keyboard.press(`${mod}+s`)
    assert.equal(await page.evaluate(() => window.saved), 1)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await step('text: Search the menus (Alt+/) finds and runs commands, and Help and the bar open it too', async () => {
    const { page, errors, bar } = await open('text')
    const dialog = page.getByRole('dialog', { name: 'Search the menus' })
    const field = dialog.getByRole('combobox', { name: 'Search the menus' })
    const inText = () => page.waitForFunction(() => document.activeElement?.closest('.cm-editor') !== null)
    await page.locator('.cm-line').first().click()
    await searchMenus(page)
    await field.waitFor()
    assert.equal(await field.evaluate((element) => element === document.activeElement), true)
    // Every menu's commands are listed, with where they live and their keys.
    await dialog.getByRole('option', { name: /^Print, File/ }).waitFor()
    await page.keyboard.type('wrap')
    const wrap = dialog.getByRole('option', { name: 'Wrap lines, View' })
    assert.equal(await wrap.getAttribute('aria-checked'), 'false')
    assert.equal(await wrap.getAttribute('aria-selected'), 'true')
    if (screenshots) await page.screenshot({ path: `${screenshots}/editor-chrome-text-menu-search.png` })
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.querySelector('.cm-lineWrapping') !== null)
    await inText()
    // The key typed nothing ("÷" on a Mac), and typing goes on in the text.
    await page.keyboard.type('#')
    await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('#'))
    assert.equal((await page.locator('.cm-content').textContent()).includes('÷'), false)
    await page.keyboard.press('Backspace')

    // Read fresh as it opens: Wrap lines is on now. Escape goes back to the text.
    await searchMenus(page)
    await page.keyboard.type('wrap')
    assert.equal(await dialog.getByRole('option', { name: 'Wrap lines, View' }).getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await inText()

    // Help ▸ Search the menus comes first, with its key.
    await bar.getByRole('menuitem', { name: 'Help' }).click()
    const helpItems = page.getByRole('menu').getByRole('menuitem')
    assert.match(await helpItems.first().textContent(), /^Search the menus(⌥\/|Alt\+\/)$/)
    if (screenshots) await page.screenshot({ path: `${screenshots}/editor-chrome-text-help-menu.png` })
    await helpItems.first().click()
    await field.waitFor()
    // A command that opens a dialog hands it the keyboard; closing that returns to the text.
    await page.keyboard.type('keyboard shortcuts')
    await page.keyboard.press('Enter')
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await shortcuts.getByRole('searchbox', { name: 'Search shortcuts' }).waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search shortcuts')
    await page.keyboard.type('search the menus')
    await shortcuts.getByText('Search the menus', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await shortcuts.waitFor({ state: 'detached' })
    await inText()

    // The button at the end of the bar; greyed commands show but do not run.
    await bar.getByRole('menuitem', { name: 'Search the menus' }).click()
    await field.waitFor()
    await page.keyboard.type('redo')
    assert.equal(await dialog.getByRole('option', { name: /^Redo, Edit/ }).getAttribute('aria-disabled'), 'true')
    await page.keyboard.press('Enter')
    assert.equal(await dialog.count(), 1)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await inText()
    assert.deepEqual(errors, [])
    await page.close()
  })

  await step('text: Alt+Shift+F (Ctrl+Option+F on a Mac) opens the File menu for the keyboard', async () => {
    const { page, errors, bar } = await open('text')
    await page.locator('.cm-line').first().click()
    await page.keyboard.press(fileMenuKey)
    const file = bar.getByRole('menuitem', { name: 'File' })
    await page.getByRole('menuitem', { name: 'Print' }).waitFor()
    assert.equal(await file.getAttribute('aria-expanded'), 'true')
    // Its first item has the keyboard; the arrow keys go on to the other menus.
    await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]') !== null && document.activeElement.getAttribute('role')?.startsWith('menuitem'))
    if (screenshots) await page.screenshot({ path: `${screenshots}/editor-chrome-text-file-menu-key.png` })
    await page.keyboard.press('ArrowRight')
    await page.getByRole('menuitem', { name: 'Find and replace' }).waitFor()
    assert.equal(await bar.getByRole('menuitem', { name: 'Edit' }).getAttribute('aria-expanded'), 'true')
    await page.keyboard.press('Escape')
    await page.getByRole('menu').waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.activeElement?.closest('.cm-editor') !== null)
    // Nothing was typed into the text.
    assert.equal(await page.locator('.cm-content').textContent(), 'def hello():    return 1')
    assert.deepEqual(errors, [])
    await page.close()
  })

  await step('notebook: Search the menus runs an Edit command from command mode, keys back to the cells', async () => {
    const { page, errors } = await open('notebook')
    await page.getByRole('list', { name: 'Notebook cells' }).focus()
    await searchMenus(page)
    const dialog = page.getByRole('dialog', { name: 'Search the menus' })
    await dialog.getByRole('combobox', { name: 'Search the menus' }).waitFor()
    await page.keyboard.type('select every')
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    await page.getByText('2 cells selected').waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Notebook cells')
    assert.deepEqual(errors, [])
    await page.close()
  })

  console.log(`editor chrome:\n${results.map((line) => `  ✓ ${line}`).join('\n')}`)
} finally {
  await browser?.close()
  await server?.close()
}
