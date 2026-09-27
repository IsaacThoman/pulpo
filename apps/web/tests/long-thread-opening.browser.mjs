import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

// Production transcript components; only transport and chat data are synthetic.
// Install Chromium with `npx playwright install chromium`, then run
// `npm run test:long-thread-opening -w @pulpo/web` after building the shared packages.
const root = new URL('..', import.meta.url).pathname
const outDir = await mkdtemp(path.join(os.tmpdir(), 'pulpo-bottom-'))
let browser, server
try {
  await build({ root, logLevel: 'error', build: { outDir, rollupOptions: { input: `${root}/tests/thread-switching/index.html` } } })
  server = await preview({ root, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  browser = await chromium.launch()
  let bottomChecks = 0
  for (const width of [1440, 390]) {
    for (const historyLatency of [0, 300, 1500]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true })
      const cdp = await page.context().newCDPSession(page)
      if (width === 390) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${server.resolvedUrls.local[0]}tests/thread-switching/index.html?turns=1200&otherTurns=1500&page=500&rich&varied&checks&historyLatency=${historyLatency}`)
      await page.locator('[data-message-id="one-1199"]').waitFor()
      const viewport = page.locator('[data-radix-scroll-area-viewport]')
      const bottom = async id => {
        const geometry = await viewport.evaluate((el, id) => {
          const last = [...el.querySelectorAll('[data-message-id]')].find(row => row.dataset.messageId === id)
          const bounds = el.getBoundingClientRect()
          const lastBounds = last?.getBoundingClientRect()
          return {
            gap: el.scrollHeight - el.scrollTop - el.clientHeight,
            lastVisible: Boolean(last && getComputedStyle(last).visibility !== 'hidden' && lastBounds.bottom > bounds.top && lastBounds.bottom <= bounds.bottom + 4),
          }
        }, id)
        assert(geometry.gap <= 4 && geometry.lastVisible, JSON.stringify({ width, historyLatency, id, ...geometry }))
        bottomChecks++
      }
      await page.waitForTimeout(2200)
      await bottom('one-1199')
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const thread of ['two', 'one']) {
          await page.mouse.move(width / 2, 350)
          await page.mouse.wheel(0, -50000)
          await page.waitForTimeout(100)
          await page.getByRole('button', { name: `Thread ${thread}`, exact: true }).click()
          await page.waitForTimeout(2200)
          await bottom(thread === 'one' ? 'one-1199' : 'two-1499')
        }
      }
      if (historyLatency === 1500) {
        // Real input must release bottom following even when the newest answer changes size.
        const capture = () => viewport.evaluate(el => {
          const top = el.getBoundingClientRect().top
          const row = [...el.querySelectorAll('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > top + 48)
          return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - top, gap: el.scrollHeight - el.scrollTop - el.clientHeight }
        })
        for (const input of ['wheel', 'keyboard', 'touch', 'scrollbar']) {
          if (input === 'wheel') {
            await page.mouse.move(width / 2, 400)
            await page.mouse.wheel(0, -800)
          } else if (input === 'keyboard') {
            await viewport.focus()
            await page.keyboard.press('PageUp')
          } else if (input === 'touch') {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: 250 }] })
            for (let y = 280; y <= 550; y += 30) {
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2, y }] })
              await page.waitForTimeout(60)
            }
            await page.waitForTimeout(200)
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          } else {
            await viewport.hover()
            const thumb = page.locator('[data-slot="scroll-area-scrollbar"] > div')
            await thumb.waitFor({ state: 'visible' })
            const bounds = await thumb.boundingBox()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
            await page.mouse.down()
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 60, { steps: 5 })
            await page.mouse.up()
          }
          await page.waitForTimeout(700)
          const anchor = await capture()
          assert(anchor.gap > 96, `${input} must move away from the bottom`)
          await page.getByRole('button', { name: 'Grow answer', exact: true }).click()
          await page.waitForTimeout(700)
          const offset = await page.locator(`[data-message-id="${anchor.id}"]`).evaluate(el => el.getBoundingClientRect().top - el.closest('[data-radix-scroll-area-viewport]').getBoundingClientRect().top)
          assert(Math.abs(offset - anchor.offset) <= 4, `${input} reading anchor moved ${offset - anchor.offset}px`)
          await page.mouse.move(width / 2, 400)
          await page.mouse.wheel(0, 1e7)
          await page.waitForTimeout(700)
          await page.getByRole('button', { name: 'Grow answer', exact: true }).click()
          await page.waitForTimeout(700)
          await bottom('one-1199')
        }
      }
      assert.equal(await page.getByLabel('Draft').inputValue(), 'Preserve this draft')
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ width, historyLatency, cpu: width === 390 ? 4 : 1, bottomChecks, readingInputs: historyLatency === 1500 ? ['wheel', 'keyboard', 'touch', 'scrollbar'] : [] }))
      await page.close()
    }
  }
} finally {
  await browser?.close()
  await server?.httpServer.close()
  await rm(outDir, { recursive: true, force: true })
}
