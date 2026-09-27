import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

// Real transcript, attachment loading, intersection observers, and virtualizer.
// Only the chat/thumbnail transport is synthetic; no production data is needed.
const root = new URL('..', import.meta.url).pathname
const outDir = await mkdtemp(path.join(os.tmpdir(), 'pulpo-attachment-scroll-'))
let browser, server
try {
  await build({ root, logLevel: 'error', build: { outDir, rollupOptions: { input: `${root}/tests/thread-switching/index.html` } } })
  server = await preview({ root, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  browser = await chromium.launch()
  for (const width of [1440, 390]) {
    for (const shape of ['wide', 'landscape', 'tall']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => {
        window.liveImageUrls = new Set()
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
        URL.createObjectURL = blob => { const url = create(blob); window.liveImageUrls.add(url); return url }
        URL.revokeObjectURL = url => { window.liveImageUrls.delete(url); revoke(url) }
      })
      await page.goto(`${server.resolvedUrls.local[0]}tests/thread-switching/index.html?turns=40&image=${shape}`)
      await page.locator('[data-message-id="one-39"]').waitFor()
      await page.waitForTimeout(700)
      const viewport = page.locator('[data-radix-scroll-area-viewport]')
      const figure = page.locator('figure[title="scroll-image.png"]')
      const position = async where => {
        await viewport.dispatchEvent('wheel', { deltaY: -1 })
        await figure.evaluate((el, where) => {
          const viewport = el.closest('[data-radix-scroll-area-viewport]')
          const bounds = el.getBoundingClientRect(), view = viewport.getBoundingClientRect()
          viewport.scrollTop += where === 'above' ? bounds.bottom - view.top + 10 : bounds.top - view.top - 150
        }, where)
      }
      const loaded = async () => {
        await page.waitForFunction(() => {
          const img = document.querySelector('figure img')
          return img?.complete && img.naturalWidth > 0
        })
        await page.waitForTimeout(100)
      }
      await position('visible')
      await loaded()
      const size = await figure.evaluate(el => ({ height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width }))
      await position('above')
      // The old landscape placeholder grows by 32px, crossing the clipping boundary
      // again and oscillating between loaded/unloaded on almost every animation frame.
      const samples = await figure.evaluate(async el => {
        const viewport = el.closest('[data-radix-scroll-area-viewport]')
        const next = document.querySelector('[data-message-id="one-30"]')
        const samples = []
        for (let frame = 0; frame < 90; frame++) {
          await new Promise(requestAnimationFrame)
          samples.push({ height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width, top: viewport.scrollTop, nextTop: next.getBoundingClientRect().top })
        }
        return samples
      })
      assert(samples.every(sample => Math.abs(sample.height - size.height) < 1 && Math.abs(sample.width - size.width) < 1), `${width}/${shape}: offscreen image changed card dimensions`)
      const settled = samples.slice(10)
      assert(Math.max(...settled.map(s => s.top)) - Math.min(...settled.map(s => s.top)) <= 1, 'Idle scroll position must settle')
      assert(Math.max(...settled.map(s => s.nextTop)) - Math.min(...settled.map(s => s.nextTop)) <= 1, 'Following message must not jitter')
      await page.waitForFunction(() => !document.querySelector('figure img') && window.liveImageUrls.size === 0)
      const readingTop = await viewport.evaluate(el => el.scrollTop)

      // Force the virtual row to unmount, then restore it while the image is offscreen.
      await viewport.evaluate(el => { el.scrollTop = 0 })
      await figure.waitFor({ state: 'detached' })
      await viewport.evaluate((el, top) => { el.scrollTop = top }, readingTop)
      await figure.waitFor({ state: 'attached' })
      const sameSize = async () => figure.evaluate((el, size) => Math.abs(el.getBoundingClientRect().height - size.height) < 1 && Math.abs(el.getBoundingClientRect().width - size.width) < 1, size)
      assert(await sameSize(), 'Virtual remount must retain image geometry')
      await position('visible')
      await loaded()
      assert(await sameSize(), 'Reloading must retain image geometry')

      // Geometry must stay responsive when the cached image is released.
      await position('above')
      await page.waitForFunction(() => window.liveImageUrls.size === 0)
      await page.setViewportSize({ width: 280, height: 900 })
      await page.waitForTimeout(350)
      const resizedHeight = await figure.evaluate(el => el.getBoundingClientRect().height)
      await position('visible')
      await loaded()
      assert(Math.abs(await figure.evaluate(el => el.getBoundingClientRect().height) - resizedHeight) < 1, 'Resized placeholder must match the reloaded image')
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ width, shape, size, idleFrames: samples.length, remount: 'stable', resize: 'stable', urls: 'released' }))
      await page.close()
    }
  }
} finally {
  await browser?.close()
  await server?.httpServer.close()
  await rm(outDir, { recursive: true, force: true })
}
