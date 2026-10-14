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
  await page.goto(`${server.resolvedUrls.local[0]}tests/suggestion-card/index.html`)

  const card = page.getByRole('dialog', { name: 'Suggestion' })
  const center = async (locator) => {
    const box = await locator.boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const moveTo = async (locator) => {
    const { x, y } = await center(locator)
    await page.mouse.move(x, y, { steps: 12 })
  }

  // Hover the suggestion, then travel to the card's buttons the way a person would.
  await page.locator('.pulpo-suggestion-delete').waitFor()
  await moveTo(page.locator('.pulpo-suggestion-delete'))
  await card.waitFor()
  assert.equal(await card.locator('span').first().textContent(), 'Replace “stinky” with “awesome”')
  await moveTo(card.getByRole('button', { name: 'Reject suggestion' }))
  await page.waitForTimeout(600)
  assert.ok(await card.isVisible(), 'the card stays while the pointer is on it')
  await moveTo(card.getByRole('button', { name: 'Accept suggestion' }))
  await page.waitForTimeout(600)
  await page.mouse.down()
  await page.mouse.up()
  await card.waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-suggestion-id]').count(), 0, 'accepting resolves the suggestion')
  assert.match(await page.locator('.pulpo-doc-editor').textContent(), /hey this is a awesome test/)

  // Leaving the card for plain text hides it again.
  await page.reload()
  await page.locator('.pulpo-suggestion-insert').waitFor()
  await moveTo(page.locator('.pulpo-suggestion-insert'))
  await card.waitFor()
  await moveTo(card)
  await page.mouse.move(900, 500, { steps: 6 })
  await card.waitFor({ state: 'detached' })

  assert.deepEqual(errors, [])
  console.log('suggestion card stays reachable while hovered')
} finally {
  await browser?.close()
  await server?.close()
}
