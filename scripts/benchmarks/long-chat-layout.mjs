import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

const out = process.env.BENCH_OUTPUT ?? '/tmp/pulpo-longchat-after'
const fixture = JSON.parse(await readFile(`${out}/fixtures.json`, 'utf8'))
const proxy = Object.fromEntries(['/api', '/health', '/socket.io'].map(path => [path, { target: 'http://127.0.0.1:3319', ws: path === '/socket.io' }]))
const server = await preview({ root: new URL('../../apps/web', import.meta.url).pathname, configFile: false, preview: { host: '127.0.0.1', port: 4319, strictPort: true, proxy } })
const browser = await chromium.launch()
const results = []
const viewport = '[data-radix-scroll-area-viewport]'
async function state(page, anchorId) {
  return page.evaluate(({ viewport, anchorId }) => {
    const scroll = document.querySelector(viewport)
    const rect = scroll.getBoundingClientRect()
    const items = [...document.querySelectorAll('[data-message-id]')].map(el => ({ id: el.dataset.messageId, y: el.getBoundingClientRect().y, h: el.getBoundingClientRect().height }))
    const visible = items.filter(el => el.y + el.h > rect.y && el.y < rect.bottom)
    const anchor = anchorId ? items.find(item => item.id === anchorId) : visible.find(item => item.y >= rect.y + 48) ?? visible[0]
    return { nodes: document.querySelectorAll('*').length, top: scroll.scrollTop, height: scroll.scrollHeight, bottomGap: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
      overflow: document.documentElement.scrollWidth > innerWidth, visible: visible.map(item => item.id), anchor, items: items.length }
  }, { viewport, anchorId })
}
try {
  for (const key of process.env.BENCH_CASES?.split(',') ?? ['plain:10', 'plain:5000', 'rich:1000', 'large:100']) {
    const c = fixture.cases.find(c => `${c.kind}:${c.turns}` === key)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addCookies([{ name: 'pulpo_session', value: fixture.token, url: 'http://127.0.0.1:4319', httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage()
    const errors = [], pages = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('response', async r => {
      if (r.url().includes(`/api/chats/${c.id}?`) && !r.ok()) errors.push(`${r.status()}: ${r.url()}`)
      if (r.url().includes(`/api/chats/${c.id}?`) && r.ok()) {
        const body = await r.json().catch(() => null)
        if (body?.history) pages.push({ before: new URL(r.url()).searchParams.get('before'), turns: body.responses.length, ...body.history })
      }
    })
    await page.goto(`http://127.0.0.1:4319/c/${c.id}`)
    await page.locator(`[data-message-id="${c.lastResponseId}"]`).filter({ hasText: `END-${c.turns}` }).waitFor({ timeout: 15000 }).catch(async error => { console.log(JSON.stringify({ failure: await state(page), errors, pages })); await page.screenshot({ path: `${out}/layout-failure.png` }); throw error })
    await page.waitForTimeout(1800)
    const initial = await state(page)
    assert(initial.bottomGap <= 4, `${key}: initial bottom gap ${initial.bottomGap}`)
    assert(!initial.overflow, `${key}: desktop overflow`)
    assert(initial.nodes < 15000, `${key}: unbounded DOM`)
    await page.screenshot({ path: `${out}/layout-${c.kind}-${c.turns}.png` })
    let prepend
    if (c.turns === 5000) {
      assert.equal(pages.length, 2, 'Initial page plus immediate warm page')
      assert(pages.every(p => p.turns === 500))
      let delayed = 0
      await page.route('**/api/chats/*', async route => {
        if (new URL(route.request().url()).searchParams.has('before')) {
          delayed++
          await new Promise(r => setTimeout(r, 1200))
        }
        await route.continue()
      })
      await page.locator(viewport).evaluate(el => { el.scrollTop = 50000 })
      await page.waitForTimeout(300)
      const before = await state(page)
      assert(delayed > 0, 'Prefetch starts far before the reader reaches the loaded edge')
      assert(before.top > 10000, 'A substantial scroll buffer remains during the delayed request')
      for (let i = 0; i < 100 && pages.length < 3; i++) await page.waitForTimeout(100)
      await page.waitForTimeout(200)
      const after = await state(page, before.anchor.id)
      assert(after.anchor, 'Visible anchor remains mounted after prepend')
      assert(Math.abs(after.anchor.y - before.anchor.y) <= 2, `Prepend jump: ${after.anchor.y - before.anchor.y}px`)
      assert.equal(pages.length, 3, 'One additional history page')
      prepend = { delayMs: 1200, bufferPx: before.top, anchorShiftPx: after.anchor.y - before.anchor.y, pages: pages.length }
      await page.unroute('**/api/chats/*')
      await page.route('**/api/chats/*', async route => {
        if (new URL(route.request().url()).searchParams.has('before')) await new Promise(r => setTimeout(r, 600))
        await route.continue()
      })
      const subsequentShifts = []
      while (pages.at(-1).hasMore) {
        const previousCount = pages.length
        await page.locator(viewport).evaluate(el => { el.scrollTop = 50000 })
        await page.waitForTimeout(150)
        const beforePage = await state(page)
        for (let i = 0; i < 100 && pages.length <= previousCount; i++) await page.waitForTimeout(100)
        await page.waitForTimeout(200)
        assert.equal(pages.length, previousCount + 1, 'Scrolling through history loads exactly one next page')
        const afterPage = await state(page, beforePage.anchor.id)
        assert(afterPage.anchor, 'Older-page anchor stays mounted')
        const shift = afterPage.anchor.y - beforePage.anchor.y
        assert(Math.abs(shift) <= 2, `Older-page prepend jump: ${shift}px`)
        subsequentShifts.push(shift)
      }
      prepend.subsequentShiftsPx = subsequentShifts
      assert.equal(pages.at(-1).offset, 0)
      await page.unroute('**/api/chats/*')
    }
    await page.locator(viewport).evaluate(el => { el.scrollTop = Math.max(0, el.scrollTop - 2000) })
    await page.waitForTimeout(300)
    const reading = await state(page)
    await page.locator('textarea').last().fill('Layout benchmark draft')
    await page.waitForTimeout(600)
    const afterTyping = await state(page, reading.anchor.id)
    assert(afterTyping.anchor && Math.abs(afterTyping.anchor.y - reading.anchor.y) <= 2, 'Typing preserves the reading position')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(800)
    const mobile = await state(page)
    assert(mobile.visible.some(id => reading.visible.includes(id)), `${key}: resize lost the reading anchor ${JSON.stringify({ reading, mobile })}`)
    assert(!mobile.overflow && mobile.visible.length > 0, `${key}: mobile layout`)
    await page.locator(viewport).evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(500)
    const mobileBottom = await state(page)
    assert(mobileBottom.bottomGap <= 4, `${key}: mobile bottom gap ${JSON.stringify(mobileBottom)}, prepend ${JSON.stringify(prepend)}`)
    await page.screenshot({ path: `${out}/layout-mobile-${c.kind}-${c.turns}.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(700)
    const resized = await state(page)
    assert(resized.bottomGap <= 4, `${key}: resize at bottom jumps ${resized.bottomGap}px`)
    assert.deepEqual(errors, [])
    const result = { key, initial, prepend, reading, typingShiftPx: afterTyping.anchor.y - reading.anchor.y, mobile, mobileBottom, resized, pages, errors }
    results.push(result)
    console.log(JSON.stringify(result))
    await writeFile(`${out}/layout.json`, JSON.stringify(results, null, 2))
    await context.close()
  }
} finally { await browser.close(); await new Promise(r => server.httpServer.close(r)) }
