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

  // The step buttons stay put while the count next to them changes width.
  await open()
  const next = page.getByRole('button', { name: 'Next suggestion' })
  const bar = page.getByRole('toolbar', { name: 'Suggestions' })
  const count = Number((await bar.textContent()).match(/(\d+) suggestions/)[1])
  const nextBox = await next.boundingBox()
  await next.click()
  assert.deepEqual(await next.boundingBox(), nextBox, 'Next stays put when the count changes')
  await next.click()
  assert.match(await bar.textContent(), new RegExp(`Suggestion 2 of ${count}`))

  // Stepping either way shows each suggestion below the toolbar, with its card in view.
  await open()
  const shown = () => page.evaluate(() => {
    const card = document.querySelector('[data-suggestion-card]')
    const id = card.getAttribute('data-suggestion-card')
    const text = document.querySelector(`[data-suggestion-id="${id}"]`).getClientRects()[0]
    return {
      id,
      textTop: text.top,
      headerBottom: document.querySelector('[aria-label="Formatting"]').closest('.sticky').getBoundingClientRect().bottom,
      cardBottom: card.getBoundingClientRect().bottom,
      frameBottom: document.querySelector('[data-scroller]').getBoundingClientRect().bottom,
    }
  })
  for (const button of [...Array(count).fill('Next suggestion'), ...Array(count).fill('Previous suggestion')]) {
    await page.getByRole('button', { name: button }).click()
    const { id, textTop, headerBottom, cardBottom, frameBottom } = await shown()
    assert.ok(textTop >= headerBottom, `${button} shows ${id} below the toolbar`)
    assert.ok(cardBottom <= frameBottom, `${button} shows the card of ${id}`)
  }

  // In a long suggestion the card goes under the line pointed at, not after the last line.
  const long = suggestion('long')
  await long.scrollIntoViewIfNeeded()
  const longBox = await long.boundingBox()
  assert.ok(longBox.height > 150, 'the long suggestion spans several lines')
  await page.mouse.move(longBox.x + 40, longBox.y + 10, { steps: 6 })
  await page.locator('[data-suggestion-card="long"]').waitFor()
  const longCard = await card.boundingBox()
  assert.ok(longCard.y - longBox.y < 50, 'the card is under the first line')

  // The shortcut accepts the suggestion at the cursor.
  await open()
  await suggestion('swap', '.pulpo-suggestion-delete').click()
  await card.waitFor()
  await page.keyboard.press('ControlOrMeta+Alt+Enter')
  await card.waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-suggestion-id="swap"]').count(), 0, 'the shortcut accepts the suggestion')

  // Escape closes the card until the cursor leaves its suggestion.
  await open()
  await suggestion('swap', '.pulpo-suggestion-insert').click()
  await card.waitFor()
  await page.keyboard.press('Escape')
  await card.waitFor({ state: 'detached' })
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  assert.equal(await card.count(), 0, 'the card stays closed while the cursor stays in the suggestion')
  await page.keyboard.press('Home')
  await suggestion('swap', '.pulpo-suggestion-insert').click()
  await card.waitFor()

  // Rejecting with the shortcut keeps the line break before the suggestion, and the keys' repeats
  // while held leave the suggestion after it alone.
  await open()
  await suggestion('afterbreak').scrollIntoViewIfNeeded()
  await page.evaluate(() => {
    const { editor } = document.querySelector('.pulpo-doc-editor')
    editor.view.focus()
    editor.commands.setTextSelection(editor.view.posAtDOM(editor.view.dom.querySelector('[data-suggestion-id="afterbreak"]'), 0))
  })
  await page.keyboard.down('ControlOrMeta')
  await page.keyboard.down('Alt')
  await page.keyboard.down('Backspace')
  await page.keyboard.down('Backspace')
  await page.keyboard.up('Backspace')
  await page.keyboard.up('Alt')
  await page.keyboard.up('ControlOrMeta')
  const lines = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.pulpo-doc-editor p')].find((paragraph) => paragraph.textContent.startsWith('Line one'))
    return { text: line.textContent, breaks: line.querySelectorAll('br:not(.ProseMirror-trailingBreak)').length, adjacent: Boolean(line.querySelector('[data-suggestion-id="adjacent"]')) }
  })
  assert.deepEqual(lines, { text: 'Line onehere tail.', breaks: 1, adjacent: true })

  // On a touch screen, tapping another suggestion moves the card at once.
  const touch = await browser.newPage({ viewport: { width: 1000, height: 600 }, hasTouch: true })
  touch.on('pageerror', (error) => errors.push(error.message))
  await touch.goto(`${server.resolvedUrls.local[0]}tests/suggestion-card/index.html`)
  const touchCard = touch.getByRole('dialog', { name: 'Suggestion' })
  await touch.locator('[data-suggestion-id="swap"].pulpo-suggestion-insert').first().tap()
  await touchCard.getByText('Replace “stinky” with “awesome”', { exact: true }).waitFor()
  await touch.locator('[data-suggestion-id="inner"]').first().tap()
  await touchCard.getByText('Add “brave”', { exact: true }).waitFor({ timeout: 150 })
  await touch.close()

  assert.deepEqual(errors, [])
  console.log('suggestion card stays reachable while hovered')
} finally {
  await browser?.close()
  await server?.close()
}
