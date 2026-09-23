import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { publishResponseEvent, publishSnapshot } from '../../apps/server/src/responses/events.js'
import { redis } from '../../apps/server/src/redis.js'
import { db } from '../../apps/server/src/database/client.js'
import { responses } from '../../apps/server/src/database/schema.js'
import { eq } from 'drizzle-orm'
import { toSnapshot } from '../../apps/server/src/responses/service.js'
if (process.env.DATABASE_URL !== 'postgres://postgres:bench@127.0.0.1:55439/pulpo') throw new Error('Expected isolated database')
const out = process.env.BENCH_OUTPUT ?? '/tmp/pulpo-longchat-benchmark'
const fixture = JSON.parse(await readFile(`${out}/fixtures.json`, 'utf8'))
const proxy = Object.fromEntries(['/api', '/health', '/socket.io'].map(path => [path, { target: 'http://127.0.0.1:3319', ws: path === '/socket.io' }]))
const server = await preview({ root: new URL('../../apps/web', import.meta.url).pathname, configFile: false, preview: { host: '127.0.0.1', port: 4319, strictPort: true, proxy } })
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
const results: any[] = []
const select = process.env.BENCH_CASES?.split(',') ?? ['plain:10', 'plain:100', 'plain:1000', 'plain:5000', 'rich:1000', 'large:100']
const repetitions = Number(process.env.BENCH_REPEATS ?? 3)
try {
for (const c of fixture.cases.filter((c: any) => select.includes(`${c.kind}:${c.turns}`))) {
 for (let repeat = 0; repeat < repetitions; repeat++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addCookies([{ name: 'pulpo_session', value: fixture.token, url: 'http://127.0.0.1:4319', httpOnly: true, sameSite: 'Lax' }])
  const page = await context.newPage(), cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (process.env.BENCH_CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.BENCH_CPU) })
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const failedRequests: any[] = []
  page.on('response', r => { if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() }) })
  await page.addInitScript(() => {
    const w = window as any
    w.__name = (value: unknown) => value
    w.bench = { longTasks: [], events: [], frames: [], writes: [], phase: 'load' }
    new PerformanceObserver(list => { for (const e of list.getEntries()) w.bench.longTasks.push({ start: e.startTime, ms: e.duration, phase: w.bench.phase }) }).observe({ type: 'longtask', buffered: true })
    new PerformanceObserver(list => { for (const e of list.getEntries()) w.bench.events.push({ name: e.name, ms: e.duration, phase: w.bench.phase }) }).observe({ type: 'event', buffered: true, durationThreshold: 16 })
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(...args: any[]) { const start = performance.now(); const r = put.apply(this, args as any); w.bench.writes.push({ store: this.name, key: args[0]?.key, ms: performance.now() - start, phase: w.bench.phase }); return r }
    let last = performance.now()
    function frame(now: number) { w.bench.frames.push({ ms: now - last, phase: w.bench.phase }); last = now; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  })
  const result: any = { kind: c.kind, turns: c.turns, messages: c.messages, repeat, cpu: Number(process.env.BENCH_CPU ?? 1), errors, failedRequests }
  try {
    const [stored] = await db.select({ lastSequence: responses.lastSequence }).from(responses).where(eq(responses.id, c.lastResponseId))
    const seq = stored.lastSequence + 1
    await redis.del(`pulpo:response:${c.lastResponseId}:events`)
    await db.update(responses).set({ status: 'in_progress', lastSequence: seq - 1 }).where(eq(responses.id, c.lastResponseId))
    const start = performance.now()
    await page.goto(`http://127.0.0.1:4319/c/${c.id}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(({ n, virtual, marker }) => virtual ? document.querySelector('[data-message-id="' + marker + '"]')?.textContent?.includes('END-' + n / 2) : document.querySelectorAll('.markdown-content').length === n, { n: c.messages, virtual: Boolean(process.env.BENCH_VIRTUAL), marker: c.lastResponseId }, { timeout: 15000 }).catch(async error => {
      result.openFailureState = await page.evaluate(() => ({ text: document.body.innerText.slice(-3000), items: [...document.querySelectorAll<HTMLElement>('[data-message-id]')].map(el => el.dataset.messageId), scroll: [...document.querySelectorAll('[data-radix-scroll-area-viewport]')].map(el => ({ top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight })) }))
      await page.screenshot({ path: `${out}/open-failure-${c.kind}-${c.turns}-${repeat}.png` })
      throw error
    })
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    result.openMs = performance.now() - start
    console.log(`Opened ${c.kind} ${c.turns} repeat ${repeat}: ${Math.round(result.openMs)}ms`)
    await page.waitForTimeout(1500)
    result.loaded = await page.evaluate(() => {
      const scrollers = [...document.querySelectorAll('[data-radix-scroll-area-viewport]')] as HTMLElement[]
      const scroll = scrollers.find(el => el.querySelector('.markdown-content'))!
      return { domElements: document.querySelectorAll('*').length, markdownBlocks: document.querySelectorAll('.markdown-content').length, scrollHeight: scroll.scrollHeight, bottomGap: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight, heap: (performance as any).memory?.usedJSHeapSize, resources: performance.getEntriesByType('resource').filter(e => e.name.includes('/api/chats/')).map((e: any) => ({ name: e.name, ms: e.duration, transfer: e.transferSize, decoded: e.decodedBodySize, encoded: e.encodedBodySize })) }
    })
    if (process.env.BENCH_VIRTUAL && c.turns >= 1000 && result.loaded.resources.length < 2) throw new Error('The warm history page did not load')
    await page.evaluate(() => { (window as any).bench.phase = 'gc' })
    await cdp.send('HeapProfiler.collectGarbage')
    await page.waitForTimeout(100)
    result.metrics = (await cdp.send('Performance.getMetrics')).metrics
    await page.evaluate(() => { (window as any).bench.phase = 'typing' })
    await page.locator('textarea').last().fill('')
    await page.locator('textarea').last().click()
    const typingStart = performance.now()
    await page.locator('textarea').last().pressSequentially('Benchmark draft typing stays correct.', { delay: 30 })
    result.typingMs = performance.now() - typingStart
    result.draftCorrect = await page.locator('textarea').last().inputValue() === 'Benchmark draft typing stays correct.'
    await page.evaluate(() => { (window as any).bench.phase = 'scroll' })
    await page.mouse.move(1050, 350)
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -550); await page.waitForTimeout(30) }
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-radix-scroll-area-viewport]')].find(el => el.querySelector('.markdown-content'))!
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      ;(window as any).bench.phase = 'stream'
      const target = [...document.querySelectorAll('.markdown-content')].at(-1)!
      ;(window as any).bench.streamSeen = []
      ;(window as any).firstMessageNode = document.querySelector('.markdown-content')
      new MutationObserver(() => { const matches = [...(target.textContent ?? '').matchAll(/BENCH-TICK-(\d+)-(\d+)/g)]; const m = matches.at(-1); if (m) (window as any).bench.streamSeen.push({ index: Number(m[1]), latency: Date.now() - Number(m[2]) }) }).observe(target, { subtree: true, childList: true, characterData: true })
    })
    const [row] = await db.select().from(responses).where(eq(responses.id, c.lastResponseId))
    const base = toSnapshot(row)
    await publishSnapshot({ ...base, status: 'in_progress', sequence: seq, updatedAt: new Date().toISOString() })
    await page.waitForTimeout(300)
    const streamStart = performance.now()
    const concurrentTyping = process.env.BENCH_TYPE_DURING_STREAM ? page.locator('textarea').last().pressSequentially(' Concurrent typing.', { delay: 60 }) : Promise.resolve()
    for (let i = 1; i <= 60; i++) {
      await publishResponseEvent({ responseId: c.lastResponseId, sequence: seq + i, type: 'response.output_text.delta', payload: { delta: ` BENCH-TICK-${i}-${Date.now()}`, item_id: `msg-${c.lastResponseId}`, output_index: 0, content_index: 0 }, emittedAt: new Date().toISOString() })
      await new Promise(r => setTimeout(r, 50))
    }
    await page.waitForFunction(() => document.querySelectorAll('.markdown-content')[document.querySelectorAll('.markdown-content').length - 1]?.textContent?.includes('BENCH-TICK-60-'), undefined, { timeout: 30000 })
    await concurrentTyping
    result.concurrentDraftCorrect = !process.env.BENCH_TYPE_DURING_STREAM || await page.locator('textarea').last().inputValue() === 'Benchmark draft typing stays correct. Concurrent typing.'
    result.streamTotalMs = performance.now() - streamStart
    await page.waitForTimeout(150) // Allow the final row measurement and bottom alignment to settle.
    result.streamIntegrity = await page.evaluate(() => ({ firstNodePreserved: (window as any).firstMessageNode === document.querySelector('.markdown-content'), tickCount: ([...document.querySelectorAll('.markdown-content')].at(-1)?.textContent?.match(/BENCH-TICK-/g) ?? []).length, bottomGap: (() => { const el = [...document.querySelectorAll('[data-radix-scroll-area-viewport]')].find(el => el.querySelector('.markdown-content'))!; return el.scrollHeight - el.scrollTop - el.clientHeight })() }))
    if (process.env.BENCH_VIRTUAL && result.streamIntegrity.bottomGap > 4) throw new Error(`Streaming left a bottom gap of ${result.streamIntegrity.bottomGap}px`)
    await page.waitForTimeout(1000)
    if (process.env.BENCH_VALIDATE_LAYOUT) {
      await page.evaluate(() => { const el = document.querySelector('[data-radix-scroll-area-viewport]')!; el.scrollTop -= 2000; (window as any).bench.phase = 'reading-stream' })
      await page.waitForTimeout(250)
      const anchor = await page.evaluate(() => { const top = document.querySelector('[data-radix-scroll-area-viewport]')!.getBoundingClientRect().top; const rows = [...document.querySelectorAll<HTMLElement>('[data-message-id]')]; const row = rows.find(el => el.getBoundingClientRect().top >= top + 48) ?? rows.find(el => el.getBoundingClientRect().bottom > top + 48)!; return { id: row.dataset.messageId!, y: row.getBoundingClientRect().y } })
      for (let i = 61; i <= 70; i++) {
        await publishResponseEvent({ responseId: c.lastResponseId, sequence: seq + i, type: 'response.output_text.delta', payload: { delta: `\n\nReading-position check ${i}. `, item_id: `msg-${c.lastResponseId}`, output_index: 0, content_index: 0 }, emittedAt: new Date().toISOString() })
        await new Promise(r => setTimeout(r, 50))
      }
      await page.waitForTimeout(500)
      result.readingAnchorShiftPx = await page.evaluate(anchor => { const row = document.querySelector(`[data-message-id="${anchor.id}"]`); return row ? row.getBoundingClientRect().y - anchor.y : null }, anchor)
      if (result.readingAnchorShiftPx === null || Math.abs(result.readingAnchorShiftPx) > 2) throw new Error('Streaming moved the reading anchor')
    }
    await page.evaluate(() => { (window as any).bench.phase = 'settle' })
    // Freeze terminal state back to the seeded response; no upstream provider involved.
    await db.update(responses).set({ status: 'completed', lastSequence: seq + 71 }).where(eq(responses.id, c.lastResponseId))
    await publishSnapshot({ ...base, status: 'completed', sequence: seq + 71, updatedAt: new Date().toISOString() })
    await page.waitForTimeout(1800)
    result.instrumentation = await page.evaluate(() => (window as any).bench)
    result.storage = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pulpo-local-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const rows = await new Promise<any[]>((resolve, reject) => { const r = database.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      database.close()
      return { persistedChats: rows.filter(row => row.key.includes(':chat-data:')).map(row => ({ key: row.key, bytes: new Blob([JSON.stringify(row.value)]).size })), estimate: await navigator.storage.estimate() }
    })
    await page.route('**/api/chats/*', route => route.abort('internetdisconnected'))
    const reloadStart = performance.now()
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 })
    try {
      await page.waitForFunction(({ n, virtual, marker }) => virtual ? document.querySelector('[data-message-id="' + marker + '"]')?.textContent?.includes('END-' + n / 2) : document.querySelectorAll('.markdown-content').length === n, { n: c.messages, virtual: Boolean(process.env.BENCH_VIRTUAL), marker: c.lastResponseId }, { timeout: c.kind === 'large' ? 20000 : 120000 })
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
      result.cachedReloadMs = performance.now() - reloadStart
      result.cachedDraftCorrect = await page.locator('textarea').last().inputValue() === ('Benchmark draft typing stays correct.' + (process.env.BENCH_TYPE_DURING_STREAM ? ' Concurrent typing.' : ''))
    } catch (error) { result.cachedReloadFailed = true; result.cachedReloadError = String(error) }
  } catch (e) {
    result.failure = String(e)
    result.failureState = await page.evaluate(() => ({ text: document.body.innerText.slice(-4000), ids: [...document.querySelectorAll<HTMLElement>('[data-message-id]')].map(el => el.dataset.messageId), scroll: [...document.querySelectorAll('[data-radix-scroll-area-viewport]')].map(el => ({ top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight })) })).catch(() => null)
    console.error(result.failure)
  }
  // Keep raw traces outside the repository. Summary generation removes per-frame data.
  results.push(result)
  await writeFile(`${out}/browser${process.env.BENCH_SUFFIX ?? ''}.json`, JSON.stringify({ browser: browser.version(), results }, null, 2))
  console.log(JSON.stringify({ kind: result.kind, turns: result.turns, repeat: result.repeat, cpu: result.cpu, openMs: result.openMs, cachedReloadMs: result.cachedReloadMs, streamIntegrity: result.streamIntegrity, readingAnchorShiftPx: result.readingAnchorShiftPx, draftCorrect: result.draftCorrect, cachedDraftCorrect: result.cachedDraftCorrect, failure: result.failure }))
  await context.close()
 }
}
} finally { await browser.close(); await new Promise<void>(r => server.httpServer.close(() => r())); }
process.exit(process.env.BENCH_VIRTUAL && results.some(result => result.failure || result.cachedReloadFailed || !result.draftCorrect || !result.cachedDraftCorrect || result.concurrentDraftCorrect === false || result.streamIntegrity?.tickCount !== 60 || result.errors.length || result.failedRequests.length) ? 1 : 0)
