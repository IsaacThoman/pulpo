import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

// Production components with deterministic, delayed activation responses. No account or API required.
const root = new URL('../../apps/web', import.meta.url).pathname
const outDir = await mkdtemp(path.join(os.tmpdir(), 'pulpo-switching-'))
let browser, server
const results = []
try {
  await build({ root, logLevel: 'error', build: { outDir, rollupOptions: { input: `${root}/tests/thread-switching/index.html` } } })
  server = await preview({ root, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  browser = await chromium.launch()
  for (const scenario of process.argv.includes('--check') ? [] : [
    { turns: 10, rich: false, cpu: 1, width: 1440 },
    { turns: 1000, rich: false, cpu: 1, width: 1440 },
    { turns: 1000, rich: true, cpu: 1, width: 1440 },
    { turns: 1000, rich: true, cpu: 4, width: 390 },
  ]) {
    const page = await browser.newPage({ viewport: { width: scenario.width, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: scenario.cpu })
    await page.goto(`${server.resolvedUrls.local[0]}tests/thread-switching/index.html?turns=${scenario.turns}&latency=200${scenario.rich ? '&rich' : ''}`)
    await page.locator(`[data-message-id="one-${scenario.turns - 1}"]`).waitFor()
    await page.waitForTimeout(500)
    async function measure(kind, button, target) {
      // Start the clock at the actual DOM click; sample computed visibility at every paint.
      await page.evaluate(({ target }) => {
        window.switchResult = null
        const viewport = document.querySelector('[data-radix-scroll-area-viewport]')
        const shared = [...viewport.querySelectorAll('[data-message-id]')].find(row => row.dataset.messageId === `one-${Number(new URLSearchParams(location.search).get('turns')) - 2}`)
        document.addEventListener('click', () => {
          const start = performance.now()
          let blankFrames = 0, frames = 0, last = start, blankMs = 0
          function sample(now) {
            const bounds = viewport.getBoundingClientRect()
            const visible = [...viewport.querySelectorAll('[data-message-id]')].filter(row => {
              const rect = row.getBoundingClientRect()
              return rect.bottom > bounds.top && rect.top < bounds.bottom && getComputedStyle(row).visibility !== 'hidden'
            })
            frames++
            if (!visible.length) { blankFrames++; blankMs += now - last }
            last = now
            const ready = visible.some(row => row.dataset.messageId === target)
            if (ready) window.switchResult = { ms: now - start, blankMs, blankFrames, frames, sharedRowRetained: shared?.isConnected ?? null }
            else if (now - start < 10000) requestAnimationFrame(sample)
            else window.switchResult = { timeout: true, blankMs, blankFrames }
          }
          requestAnimationFrame(sample)
        }, { once: true, capture: true })
      }, { target })
      await button.click()
      await page.waitForFunction(() => window.switchResult !== null)
      const result = await page.evaluate(() => window.switchResult)
      assert(!result.timeout, JSON.stringify({ scenario, kind, result, errors }))
      // Let the background acknowledgment and any follow-up measurements finish before the next switch.
      await page.waitForTimeout(500)
      const gap = await page.locator('[data-radix-scroll-area-viewport]').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
      assert(gap <= 4, `Bottom alignment: ${gap}, ${JSON.stringify({ scenario, kind })}`)
      assert.equal(await page.getByLabel('Draft').inputValue(), 'Preserve this draft')
      results.push({ ...scenario, kind, ...result, gap })
    }
    for (let repeat = 0; repeat < 3; repeat++) {
      await measure('cached-thread', page.getByRole('button', { name: 'Thread two', exact: true }), `two-${scenario.turns - 1}`)
      await measure('cached-thread', page.getByRole('button', { name: 'Thread one', exact: true }), `one-${scenario.turns - 1}`)
      await measure(repeat ? 'cached-branch' : 'cold-branch', page.getByRole('button', { name: 'Next branch', exact: true }), `one-${scenario.turns - 1}-alt`)
      await measure('cached-branch', page.getByRole('button', { name: 'Previous branch', exact: true }), `one-${scenario.turns - 1}`)
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(JSON.stringify({ scenario, samples: results.slice(-12) }))
  }
  if (process.argv.includes('--check')) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${server.resolvedUrls.local[0]}tests/thread-switching/index.html?turns=1200&otherTurns=8&page=500&rich&checks&latency=200`)
      const viewport = page.locator('[data-radix-scroll-area-viewport]')
      const bottom = async id => {
        await page.locator(`[data-message-id="${id}"]`).waitFor()
        await page.waitForTimeout(500)
        const gap = await viewport.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
        assert(gap <= 4, `${width}px ${id}: bottom gap ${gap}`)
      }
      await bottom('one-1199')
      if (process.env.BENCH_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.BENCH_SCREENSHOT_DIR}/switching-bottom-${width}.png` })
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: 'Thread two', exact: true }).click()
        await bottom('two-7')
        assert.equal(await page.locator('[data-message-id^="one-"]').count(), 0)
        await page.getByRole('button', { name: 'Thread one', exact: true }).click()
        await bottom('one-1199')
        await page.getByRole('button', { name: 'Short branch', exact: true }).click()
        await bottom('one-1194-alt')
        assert.equal(await page.locator('[data-message-id="one-1199"]').count(), 0)
        await page.getByRole('button', { name: 'Original branch', exact: true }).click()
        await bottom('one-1199')
      }
      // Preserve unsaved inline drafts across branch updates, but discard them on a thread change.
      const edited = page.locator('[data-message-id="one-1198"]')
      await edited.getByRole('button', { name: 'Edit response', exact: true }).click()
      await edited.getByRole('textbox').fill('Keep my inline draft')
      await page.locator('[data-message-id="one-1199"]').getByRole('button', { name: 'Next branch', exact: true }).click()
      await bottom('one-1199-alt')
      assert.equal(await edited.getByRole('textbox').inputValue(), 'Keep my inline draft')
      await edited.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('button', { name: 'Original branch', exact: true }).click()
      await bottom('one-1199')
      await page.getByRole('button', { name: 'Grow answer', exact: true }).click()
      await bottom('one-1199')
      // Read earlier history, prepend, and resize while keeping a visible row in place.
      await page.mouse.move(width / 2, 350)
      await page.mouse.wheel(0, -2500)
      await page.waitForTimeout(500)
      const capture = () => viewport.evaluate(el => {
        const top = el.getBoundingClientRect().top
        const row = [...el.querySelectorAll('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > top + 48)
        return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - top }
      })
      const anchor = await capture()
      await page.setViewportSize({ width: width === 1440 ? 900 : 450, height: 900 })
      await page.waitForTimeout(600)
      const anchorOffset = await page.locator(`[data-message-id="${anchor.id}"]`).evaluate(el => el.getBoundingClientRect().top - el.closest('[data-radix-scroll-area-viewport]').getBoundingClientRect().top)
      assert(Math.abs(anchorOffset - anchor.offset) <= 4, `Resize moved anchor ${anchorOffset - anchor.offset}px`)
      for (let i = 0; i < 8; i++) {
        await viewport.evaluate(el => { el.scrollTop = 0 })
        await page.waitForTimeout(300)
      }
      await page.locator('[data-message-id="one-0:input"]').waitFor()
      assert.equal(await page.getByLabel('Draft').inputValue(), 'Preserve this draft')
      assert.deepEqual(errors, [])
      if (process.env.BENCH_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.BENCH_SCREENSHOT_DIR}/switching-${width}.png` })
      console.log(JSON.stringify({ width, mixedLengths: true, shortBranches: true, inlineDraft: true, grownAnswer: true, fullHistory: true, resizeAnchorMovement: anchorOffset - anchor.offset, errors }))
      await page.close()
    }
  }
  if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  await server?.httpServer.close()
  await rm(outDir, { recursive: true, force: true })
}
