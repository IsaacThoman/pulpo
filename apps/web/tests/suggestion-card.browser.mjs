// Run with: npm run test:suggestion-card -w @pulpo/web
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const open = async () => {
    await page.goto(`${server.resolvedUrls.local[0]}tests/suggestion-card/index.html`)
    await page.locator('[data-suggestion-id="swap"]').first().waitFor()
  }

  const card = page.getByRole('dialog', { name: 'Suggestion' })
  const suggestion = (id, kind = '') => page.locator(`[data-suggestion-id="${id}"]${kind}`).first()
  const moveTo = async (locator) => {
    const box = await locator.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
  }
  const describe = () => card.locator('span').first().textContent()

  // Hover the suggestion, then travel to the card's buttons the way a person would.
  await open()
  await moveTo(suggestion('swap', '.pulpo-suggestion-delete'))
  await card.waitFor()
  assert.equal(await describe(), 'Replace “stinky” with “awesome”')
  await moveTo(card.getByRole('button', { name: 'Reject suggestion' }))
  await page.waitForTimeout(600)
  assert.ok(await card.isVisible(), 'the card stays while the pointer is on it')
  await moveTo(card.getByRole('button', { name: 'Accept suggestion' }))
  await page.waitForTimeout(600)
  await page.mouse.down()
  await page.mouse.up()
  await card.waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-suggestion-id="swap"]').count(), 0, 'accepting resolves the suggestion')
  assert.match(await page.locator('.pulpo-doc-editor').textContent(), /hey this is a awesome test/)

  // Leaving the card for plain text hides it again.
  await open()
  await moveTo(suggestion('swap', '.pulpo-suggestion-insert'))
  await card.waitFor()
  await moveTo(card)
  await moveTo(page.getByText('Filler line 3.'))
  await card.waitFor({ state: 'detached' })

  // Getting to a word suggested inside a suggested paragraph crosses the paragraph first; the card
  // moves to the word once the pointer stays on it. Reaching that card crosses the paragraph again,
  // which must not take the card back.
  await moveTo(suggestion('inner'))
  await card.getByText('Add “brave”', { exact: true }).waitFor()
  await moveTo(card.getByRole('button', { name: 'Accept suggestion' }))
  await page.waitForTimeout(600)
  assert.equal(await describe(), 'Add “brave”', 'the card stays on the inner suggestion')
  await page.mouse.down()
  await page.mouse.up()
  assert.equal(await page.locator('[data-suggestion-id="inner"]').count(), 0, 'the inner suggestion is accepted')
  assert.equal(await page.locator('[data-suggestion-id="outer"]').count(), 1, 'the paragraph around it is still suggested')

  // The card of the suggestion at the cursor scrolls under the sticky toolbar, not over it.
  await open()
  await suggestion('swap', '.pulpo-suggestion-delete').click()
  await card.waitFor()
  await moveTo(page.getByRole('toolbar', { name: 'Formatting' }))
  const covered = await page.evaluate(() => {
    const scroller = document.querySelector('[data-scroller]')
    const header = document.querySelector('[aria-label="Formatting"]').closest('.sticky').getBoundingClientRect()
    scroller.scrollTop += document.querySelector('[data-suggestion-card]').getBoundingClientRect().top - header.top - 8
    const box = document.querySelector('[data-suggestion-card]').getBoundingClientRect()
    if (box.top >= header.bottom) return 'no overlap'
    return document.elementFromPoint(box.left + box.width / 2, (box.top + header.bottom) / 2)?.closest('[data-suggestion-card]') ? 'card' : 'toolbar'
  })
  assert.equal(covered, 'toolbar', 'the toolbar stays on top of the card')

  assert.deepEqual(errors, [])
  console.log('suggestion card stays reachable while hovered')
} finally {
  await browser?.close()
  await server?.close()
}
