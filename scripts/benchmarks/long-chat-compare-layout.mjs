import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

const base = process.env.BENCH_BASE_WEB
if (!base) throw new Error('Set BENCH_BASE_WEB to an already-built baseline apps/web directory')
const out = process.env.BENCH_OUTPUT ?? '/tmp/pulpo-longchat-after'
const fixture = JSON.parse(await readFile(`${out}/fixtures.json`, 'utf8'))
const proxy = Object.fromEntries(['/api', '/health', '/socket.io'].map(path => [path, { target: 'http://127.0.0.1:3319', ws: path === '/socket.io' }]))
const browser = await chromium.launch()
const results = []
try {
  for (const key of ['plain:10', 'rich:1000']) {
    const c = fixture.cases.find(c => `${c.kind}:${c.turns}` === key)
    for (const width of [1440, 390]) {
      const samples = []
      for (const [label, root] of [['baseline', base], ['current', new URL('../../apps/web', import.meta.url).pathname]]) {
        const server = await preview({ root, configFile: false, preview: { host: '127.0.0.1', port: 4319, strictPort: true, proxy } })
        const context = await browser.newContext({ viewport: { width, height: 900 } })
        try {
          await context.addCookies([{ name: 'pulpo_session', value: fixture.token, url: 'http://127.0.0.1:4319', httpOnly: true, sameSite: 'Lax' }])
          const page = await context.newPage()
          console.log(JSON.stringify({ opening: key, width, label }))
          await page.goto(`http://127.0.0.1:4319/c/${c.id}`)
          await page.waitForFunction(marker => [...document.querySelectorAll('.markdown-content')].at(-1)?.textContent?.includes(marker), `END-${c.turns}`, { timeout: 15000 }).catch(async error => { console.log(JSON.stringify({ label, key, state: await page.evaluate(() => ({ text: document.body.innerText.slice(-3000), markdown: document.querySelectorAll('.markdown-content').length })) })); throw error })
          await page.locator('textarea').last().fill('')
          await page.waitForTimeout(1200)
          for (let i = 0; i < 3; i++) {
            await page.locator('[data-radix-scroll-area-viewport]').evaluate(el => { el.scrollTop = el.scrollHeight })
            await page.waitForTimeout(150)
          }
          const geometry = await page.evaluate(() => {
            const elements = [...document.querySelectorAll('.markdown-content')].slice(-2)
            elements.push(document.querySelector('textarea'), document.querySelector('.chat-header'))
            return elements.map(el => { const rect = el.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
          })
          await page.screenshot({ path: `${out}/compare-${label}-${c.kind}-${width}.png` })
          samples.push(geometry)
        } finally { await context.close(); await new Promise(r => server.httpServer.close(r)) }
      }
      const differences = samples[0].map((before, i) => Object.fromEntries(Object.entries(before).map(([k, v]) => [k, samples[1][i][k] - v])))
      assert(differences.every(row => Object.values(row).every(value => Math.abs(value) <= 4)), `${key} ${width}px layout changed: ${JSON.stringify(differences)}`)
      results.push({ key, width, differences })
      console.log(JSON.stringify(results.at(-1)))
    }
  }
  await writeFile(`${out}/layout-comparison.json`, JSON.stringify(results, null, 2))
} finally { await browser.close() }
