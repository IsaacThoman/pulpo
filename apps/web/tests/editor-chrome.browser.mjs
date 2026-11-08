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

  console.log(`editor chrome:\n${results.map((line) => `  ✓ ${line}`).join('\n')}`)
} finally {
  await browser?.close()
  await server?.close()
}
