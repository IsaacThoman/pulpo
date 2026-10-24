// Run with: npm run test:doc-dictation -w @pulpo/web
// Install the browsers once with: npx playwright install chromium webkit
// Set SCREENSHOT_DIR to also save screenshots of the dictation bar.
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
const screenshots = process.env.SCREENSHOT_DIR
let server
const browsers = []
try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch()
    browsers.push(browser)
    const page = await browser.newPage({ viewport: { width: 1000, height: 640 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const open = async (query = '') => {
      await page.goto(`${server.resolvedUrls.local[0]}tests/doc-dictation/index.html${query}`)
      await page.locator('.pulpo-doc-editor h1').waitFor()
    }
    const editor = page.locator('.pulpo-doc-editor')
    const bar = page.locator('.pulpo-doc-dictation')
    const recording = () => page.getByRole('status', { name: /^Recording / }).waitFor()
    const hidden = () => page.waitForFunction(() => document.querySelector('.pulpo-doc-dictation')?.getAttribute('data-active') === 'false')
    /** Clicks at the end of the first paragraph, where the transcript should go. */
    const clickAfterFirstParagraph = async () => {
      const box = await editor.locator('p').first().boundingBox()
      // The paragraph is as wide as the page: this is past the end of its text.
      await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2)
    }
    /** The floating bar's distance from the bottom of the document's scrolling view. */
    const gapToViewBottom = () => page.evaluate(() => {
      const view = document.querySelector('[data-scroller]').getBoundingClientRect()
      return view.bottom - document.querySelector('.pulpo-doc-dictation').getBoundingClientRect().bottom
    })
    const shoot = async (file) => { if (screenshots) await page.screenshot({ path: `${screenshots}/${name}-${file}.png` }) }

    // A short document: the bar floats at the bottom of the view, and the words land at the cursor.
    await open()
    assert.equal(await bar.getAttribute('data-active'), 'false')
    assert.ok(!(await bar.isVisible()), 'the bar is hidden until dictating')
    await shoot('idle')
    await clickAfterFirstParagraph()
    await page.getByRole('button', { name: 'Dictate' }).click()
    await recording()
    await page.waitForTimeout(1200)
    const gap = await gapToViewBottom()
    assert.ok(gap > 8 && gap < 32, `the bar floats at the bottom of the view (${gap}px above it)`)
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('pulpo-doc-editor')), true, 'the caret stays in the document')
    await shoot('recording')
    await page.getByRole('button', { name: 'Finish dictation' }).click()
    await page.getByRole('status', { name: 'Transcribing…' }).waitFor()
    await shoot('transcribing')
    await editor.getByText('Agreed to ship the editor this week, and dictation lands right at the cursor.').waitFor()
    await hidden()

    // A long document scrolled to its top: the bar stays in view rather than after the last line.
    await open('?long&theme=dark')
    await clickAfterFirstParagraph()
    await page.keyboard.press(`${name === 'webkit' || process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+D`)
    await recording()
    await page.waitForTimeout(1200)
    const longGap = await gapToViewBottom()
    assert.ok(longGap > 8 && longGap < 32, `the bar stays at the bottom of a long document's view (${longGap}px above it)`)
    await shoot('recording-dark')
    await page.keyboard.press('Escape')
    await hidden()
    assert.equal(await editor.locator('p').first().textContent(), 'Agreed to ship the editor this week,', 'cancelling adds nothing')

    // Nothing heard: the problem shows where the bar was.
    await open('?transcript=%20')
    await page.getByRole('button', { name: 'Dictate' }).click()
    await recording()
    await page.getByRole('button', { name: 'Finish dictation' }).click()
    await page.getByRole('alert').getByText('No speech was detected in the recording').waitFor()
    await shoot('error')

    assert.deepEqual(errors, [])
    console.log(`${name}: document dictation passed`)
  }
} finally {
  await Promise.all(browsers.map((browser) => browser.close()))
  await server?.close()
}
