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
try {
  for (let repeat = 0; repeat < 20; repeat++) {
    const c = fixture.cases.find(c => c.kind === (repeat % 5 === 4 ? 'plain' : 'rich') && c.turns === 1000)
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addCookies([{ name: 'pulpo_session', value: fixture.token, url: 'http://127.0.0.1:4319', httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage()
    // Vary summary/detail arrival order; summary hydration must preserve pagination.
    if (repeat % 2 === 0) await page.route('**/api/chats', async route => { await new Promise(resolve => setTimeout(resolve, 750)); await route.continue() })
    const errors = [], pages = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('response', response => { if (response.url().includes(`/api/chats/${c.id}?`)) pages.push({ status: response.status(), ok: response.ok(), older: new URL(response.url()).searchParams.has('before') }) })
    await page.goto(`http://127.0.0.1:4319/c/${c.id}`)
    await page.locator(`[data-message-id="${c.lastResponseId}"]`).filter({ hasText: `END-${c.turns}` }).waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    const bottomGap = await page.locator('[data-radix-scroll-area-viewport]').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    assert.equal(pages.length, 2, `Cold open ${repeat}: initial and warm page`)
    assert(pages.every(page => page.ok) && pages.some(page => page.older), JSON.stringify(pages))
    assert(bottomGap <= 4, `Cold open ${repeat}: bottom gap ${bottomGap}`)
    assert.deepEqual(errors, [])
    results.push({ kind: c.kind, turns: c.turns, repeat, pageCount: pages.length, bottomGap, errors })
    console.log(JSON.stringify(results.at(-1)))
    await context.close()
    // Avoid turning repeated application bootstrap into a rate-limit test.
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  await writeFile(`${out}/opening.json`, JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
