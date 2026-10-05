import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

// Production builds and real components. Optional --baseline=<git-ref> substitutes only the
// layout/panel implementation so the same fixture, data, dependencies, and browser compare it.
const root = path.resolve(new URL('..', import.meta.url).pathname)
const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length)
const variants = baseline ? [baseline, 'working-tree'] : ['working-tree']
const chats = Number(process.env.SIDEBAR_BENCH_CHATS ?? 200)
const cpu = Number(process.env.SIDEBAR_BENCH_CPU ?? 2)
const browser = await chromium.launch()
const results = []
try {
  for (const variant of variants) {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'pulpo-sidebar-animation-'))
    let server
    try {
      const replacements = new Map()
      const appliedReplacements = new Set()
      if (variant !== 'working-tree') {
        for (const file of ['components/layout/AppLayout.tsx', 'features/side-panel/SidePanel.tsx']) {
          replacements.set(`${root}/src/${file}`, execFileSync('git', ['show', `${variant}:apps/web/src/${file}`], { cwd: root, encoding: 'utf8' }))
        }
      }
      await build({
        root, logLevel: 'error',
        plugins: [{
          name: 'sidebar-benchmark-counters', enforce: 'pre',
          transform(source, id) {
            if (replacements.has(id)) appliedReplacements.add(id)
            let code = replacements.get(id) ?? source
            const count = name => `window.sidebarRenders && window.sidebarRenders.${name}++;`
            if (id.endsWith('/components/layout/AppLayout.tsx')) code = code.replace('export function AppLayout() {', `export function AppLayout() { ${count('layout')}`)
            if (id.endsWith('/components/layout/Sidebar.tsx')) {
              code = code.replace('  const { chatId } = useParams()', `  ${count('sidebar')}\n  const { chatId } = useParams()`)
              code = code.replace('  const [renameOpen, setRenameOpen]', `  ${count('rows')}\n  const [renameOpen, setRenameOpen]`)
            }
            if (id.endsWith('/pages/files/FilesPage.tsx')) code = code.replace("  const panel = layout === 'panel'", `  ${count('files')}\n  const panel = layout === 'panel'`)
            return code === source ? null : { code, map: null }
          },
        }],
        build: { outDir, rollupOptions: { input: `${root}/tests/sidebar-animation/index.html` } },
      })
      assert.equal(appliedReplacements.size, replacements.size, 'Every requested baseline source must be substituted')
      server = await preview({ root, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
      for (const panel of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.route('**/api/**', route => route.fulfill({ json: { data: [] } }))
        await page.addInitScript(() => { window.sidebarRenders = { layout: 0, sidebar: 0, rows: 0, files: 0 } })
        await page.goto(`${server.resolvedUrls.local[0]}tests/sidebar-animation/index.html?chats=${chats}`)
        await page.locator('.desktop-sidebar').waitFor()
        if (panel) {
          await page.evaluate(() => window.benchmarkPanel(true))
          await page.getByRole('heading', { name: 'My files' }).waitFor()
          assert(await page.evaluate(() => window.sidebarRenders.files > 0), 'File render counter must be installed')
        }
        await page.waitForTimeout(600)
        const client = await page.context().newCDPSession(page)
        await client.send('Emulation.setCPUThrottlingRate', { rate: cpu })
        await client.send('Performance.enable')
        const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
        const before = await metrics()
        const samples = []
        for (let toggle = 0; toggle < 6; toggle++) {
          samples.push(await page.evaluate(async () => {
            window.sidebarRenders = { layout: 0, sidebar: 0, rows: 0, files: 0 }
            const gaps = []
            let last = performance.now()
            const start = last
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))
            while (performance.now() - start < 500) {
              await new Promise(requestAnimationFrame)
              const now = performance.now()
              gaps.push(now - last)
              last = now
            }
            return { renders: { ...window.sidebarRenders }, gaps }
          }))
        }
        const after = await metrics()
        const gaps = samples.flatMap(sample => sample.gaps).sort((a, b) => a - b)
        const result = {
          variant, panel, chats, cpu, toggles: samples.length,
          layoutRenders: samples.map(sample => sample.renders.layout),
          sidebarRenders: samples.map(sample => sample.renders.sidebar),
          rowRenders: samples.map(sample => sample.renders.rows),
          fileRenders: samples.map(sample => sample.renders.files),
          p95FrameMs: Math.round(gaps[Math.floor(gaps.length * .95)] * 10) / 10,
          framesOver25ms: gaps.filter(gap => gap > 25).length,
          scriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000),
          taskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000),
        }
        results.push(result)
        console.log(JSON.stringify(result))
        assert(samples.every(sample => sample.renders.layout >= 1 && sample.renders.rows >= chats), 'Layout and row render counters must be installed')
        if (variant === 'working-tree') {
          assert(samples.every(sample => sample.renders.layout <= 2), 'Animation must not rerender AppLayout each frame')
          assert(samples.every(sample => sample.renders.sidebar <= 3), 'Animation must not rerender the sidebar each frame')
          assert(samples.every(sample => sample.renders.rows <= chats * 3), 'Chat row work must stay bounded per toggle')
          if (panel) assert(samples.every(sample => sample.renders.files === 0), 'Stable-width file content must not rerender during sidebar animation')
          // Keep testing the actual panel interactions after measuring, without CPU throttling.
          await client.send('Emulation.setCPUThrottlingRate', { rate: 1 })
          await page.evaluate(() => window.benchmarkPanel(true))
          await page.getByRole('heading', { name: 'My files' }).waitFor()
          const separator = page.getByRole('separator', { name: 'Resize side panel' })
          await separator.focus()
          const oldWidth = Number(await separator.getAttribute('aria-valuenow'))
          await separator.press('ArrowLeft')
          assert.equal(Number(await separator.getAttribute('aria-valuenow')), oldWidth + 32)
          await separator.press('ArrowRight')
          const handle = await separator.boundingBox()
          await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
          await page.mouse.down()
          await page.mouse.move(handle.x - 60, handle.y + handle.height / 2, { steps: 5 })
          await page.mouse.up()
          assert(Number(await separator.getAttribute('aria-valuenow')) > oldWidth)
          // Narrow desktop: the sidebar folds first; explicitly reopening it hides the panel.
          await page.setViewportSize({ width: 850, height: 900 })
          await page.waitForTimeout(500)
          assert(await page.locator('.desktop-collapsed-sidebar').count())
          assert(await page.locator('[data-side-panel]').count())
          await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })))
          await page.waitForTimeout(500)
          assert.equal(await page.locator('[data-side-panel]').count(), 0)
          assert.equal(await page.evaluate(() => window.benchmarkSplitAvailable()), false)
          // Closing the sidebar restores the retained panel.
          await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })))
          await page.waitForTimeout(500)
          assert(await page.locator('[data-side-panel]').count())
          const main = await page.locator('.app-main').boundingBox()
          const side = await page.locator('[data-side-panel]').boundingBox()
          assert(main.width >= 359 && main.x + main.width <= side.x + 1, 'Views must fit without overlapping')
          // Mobile full-panel mode preserves the underlying main view and its draft.
          await page.setViewportSize({ width: 390, height: 900 })
          await page.waitForTimeout(300)
          assert(await page.locator('[data-side-panel][data-full]').count())
          assert.equal(await page.locator('.app-main').isVisible(), false)
          await page.evaluate(() => window.benchmarkPanel(false))
          await page.getByRole('textbox', { name: 'Draft' }).waitFor()
          assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Keep this draft')
        }
        assert.deepEqual(errors, [])
        await page.close()
      }
    } finally {
      await server?.httpServer.close()
      await rm(outDir, { recursive: true, force: true })
    }
  }
} finally { await browser.close() }
console.log(JSON.stringify({ results, status: 'passed' }))
