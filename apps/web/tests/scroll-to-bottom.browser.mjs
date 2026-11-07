import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

// Production transcript components; only transport and chat data are synthetic.
// Install Chromium with `npx playwright install chromium`, then run
// `npm run test:scroll-to-bottom -w @pulpo/web` after building the shared packages.
const root = new URL('..', import.meta.url).pathname
const outDir = await mkdtemp(path.join(os.tmpdir(), 'pulpo-jump-'))
const screenshots = process.env.SCROLL_TO_BOTTOM_SCREENSHOTS
let browser, server
try {
  await build({ root, logLevel: 'error', build: { outDir, rollupOptions: { input: `${root}/tests/thread-switching/index.html` } } })
  server = await preview({ root, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  browser = await chromium.launch()
  for (const [width, reducedMotion] of [[1440, 'no-preference'], [390, 'no-preference'], [1440, 'reduce']]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true, reducedMotion })
    const cdp = await page.context().newCDPSession(page)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${server.resolvedUrls.local[0]}tests/thread-switching/index.html?turns=400&page=200&rich&varied&checks`)
    await page.locator('[data-message-id="one-399"]').waitFor()
    const viewport = page.locator('[data-radix-scroll-area-viewport]')
    const button = page.getByTestId('chat-scroll-to-bottom')
    const gap = () => viewport.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    const shown = () => button.evaluate(el => !el.inert && getComputedStyle(el).opacity === '1')
    const settle = () => page.waitForTimeout(400)
    const context = { width, reducedMotion }

    await page.waitForTimeout(1500)
    assert(await gap() <= 4, JSON.stringify({ ...context, step: 'opened at bottom', gap: await gap() }))
    assert(!(await shown()), JSON.stringify({ ...context, step: 'hidden at bottom' }))

    // A short nudge away from the tail is still "at the latest message".
    await page.mouse.move(width / 2, 400)
    await page.mouse.wheel(0, -120)
    await settle()
    assert(!(await shown()), JSON.stringify({ ...context, step: 'hidden near bottom', gap: await gap() }))

    // Reading further up offers the jump, and changing content below does not hide it.
    // (The fixture's replacement answer is shorter than the original, so read well above it.)
    await page.mouse.wheel(0, -12000)
    await settle()
    assert(await shown(), JSON.stringify({ ...context, step: 'shown after reading up', gap: await gap() }))
    if (screenshots && reducedMotion === 'no-preference') await page.screenshot({ path: path.join(screenshots, `scroll-to-bottom-${width}.png`) })
    await page.getByRole('button', { name: 'Grow answer' }).click()
    await settle()
    assert(await shown(), JSON.stringify({ ...context, step: 'shown while answer grows', gap: await gap() }))

    await button.click()
    await page.waitForTimeout(1200)
    assert(await gap() <= 4, JSON.stringify({ ...context, step: 'jumped to bottom', gap: await gap() }))
    assert(!(await shown()), JSON.stringify({ ...context, step: 'hidden after jump' }))

    // Following resumes after the jump, so later growth stays pinned to the tail.
    await page.getByRole('button', { name: 'Grow answer' }).click()
    await settle()
    assert(await gap() <= 4, JSON.stringify({ ...context, step: 'follows after jump', gap: await gap() }))

    // Long jumps from deep in the history still land on the tail.
    await page.mouse.move(width / 2, 400)
    await page.mouse.wheel(0, -50000)
    await page.waitForTimeout(800)
    assert(await shown(), JSON.stringify({ ...context, step: 'shown deep in history' }))
    await button.click()
    await page.waitForTimeout(1500)
    assert(await gap() <= 4, JSON.stringify({ ...context, step: 'long jump to bottom', gap: await gap() }))

    // Touch readers get the same affordance.
    if (width === 390) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: 200 }] })
      for (let y = 230; y <= 800; y += 30) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2, y }] })
        await page.waitForTimeout(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(800)
      assert(await shown(), JSON.stringify({ ...context, step: 'shown after touch scroll', gap: await gap() }))
    }

    // Switching threads starts at the tail without a stale offer.
    await page.mouse.move(width / 2, 400)
    await page.mouse.wheel(0, -3000)
    await settle()
    await page.getByRole('button', { name: 'Thread two', exact: true }).click()
    await page.waitForTimeout(1500)
    assert(!(await shown()), JSON.stringify({ ...context, step: 'hidden after switching threads' }))
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Scroll-to-bottom checks passed')
} finally {
  await browser?.close()
  await new Promise(resolve => server ? server.httpServer.close(resolve) : resolve())
  await rm(outDir, { recursive: true, force: true })
}
