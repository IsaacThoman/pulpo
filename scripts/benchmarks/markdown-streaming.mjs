import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

// Actual production Markdown and plugins, isolated from sockets, store transforms and layout.
// Both versions use this checkout's dependencies. Only Markdown.tsx differs for --baseline.
const repo = fileURLToPath(new URL('../../', import.meta.url))
const web = path.join(repo, 'apps/web')
const temporary = await mkdtemp(path.join(repo, 'apps/web/node_modules/.markdown-streaming-'))
const outDir = await mkdtemp(path.join(os.tmpdir(), 'pulpo-markdown-streaming-'))
const baselineIndex = process.argv.indexOf('--baseline')
const baseline = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : undefined
assert(baselineIndex < 0 || baseline, '--baseline requires a commit')
const durationMs = Number(process.env.BENCH_DURATION_MS ?? 1500)
const repeats = Number(process.env.BENCH_REPEATS ?? 3)
const cpu = Number(process.env.BENCH_CPU ?? 1)
const results = []
let browser, server
try {
  let markdownSource = path.join(web, 'src/components/chat/Markdown.tsx')
  if (baseline) {
    markdownSource = path.join(temporary, 'Markdown.tsx')
    await writeFile(markdownSource, execFileSync('git', ['show', `${baseline}:apps/web/src/components/chat/Markdown.tsx`], { cwd: repo }))
  }
  await writeFile(path.join(temporary, 'index.html'), '<div id="root"></div><script type="module" src="./fixture.tsx"></script>')
  await writeFile(path.join(temporary, 'fixture.tsx'), `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Markdown } from ${JSON.stringify(markdownSource)}
import ${JSON.stringify(path.join(web, 'src/index.css'))}
import ${JSON.stringify(path.join(web, 'src/i18n/index.ts'))}

const plain = 'A paragraph of ordinary prose describing the work in progress. '.repeat(160)
const rich = ('## Streaming details\\n\\nA **formatted** paragraph with [a link](https://example.com).\\n\\n- One item\\n- Another item\\n\\n| Name | Value |\\n| --- | --- |\\n| Time | 42 |\\n\\n' + '\x60\x60\x60typescript\\nconst answer: number = 42\\nconsole.log(answer)\\n\x60\x60\x60\\n\\n').repeat(35)
const large = 'A paragraph of ordinary prose describing the work in progress. '.repeat(5000)
const fixtures = { plain, rich, large }
let update
function App() {
  const [state, setState] = useState({ content: 'Ready', streaming: false })
  update = setState
  return <main style={{ maxWidth: 760, margin: '0 auto' }}><label>Draft<input aria-label="Draft" defaultValue="Keep this draft" /></label><Markdown content={state.content} streaming={state.streaming} caret={state.streaming} /></main>
}
flushSync(() => createRoot(document.getElementById('root')).render(<App />))
window.benchStart = async ({ kind, hz, durationMs }) => {
  const content = fixtures[kind]
  flushSync(() => update({ content, streaming: true }))
  await new Promise(resolve => setTimeout(resolve, 250))
  // Deterministic diagnostic outside timed samples: no display timer runs within this task.
  window.__mdParseSamples = []
  for (let index = 1; index <= 20; index++) flushSync(() => update({ content: content + '\\n\\nProbe ' + index, streaming: true }))
  const redundantBurstParses = window.__mdParseSamples.length
  window.__mdParseSamples = null
  flushSync(() => update({ content, streaming: true }))
  await new Promise(resolve => setTimeout(resolve, 250))
  const firstLink = document.querySelector('.markdown-content a')
  const firstCode = document.querySelector('.code-highlight')
  const draft = document.querySelector('input')
  draft.focus()
  const frames = [], longTasks = []
  const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)))
  observer.observe({ type: 'longtask' })
  window.__mdParseSamples = []
  let lastFrame = performance.now(), animation, active = true
  const frame = now => { frames.push(now - lastFrame); lastFrame = now; if (active) animation = requestAnimationFrame(frame) }
  animation = requestAnimationFrame(frame)
  const started = performance.now()
  const count = Math.round(durationMs * hz / 1000)
  let finalContent = content
  for (let index = 1; index <= count; index++) {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, started + index * 1000 / hz - performance.now())))
    finalContent = content + '\\n\\nDelta ' + index
    // Each independently delivered chunk commits, avoiding a scheduler-dependent batching confound.
    flushSync(() => update({ content: finalContent, streaming: true }))
  }
  flushSync(() => update({ content: finalContent + ' completed', streaming: false }))
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const elapsedMs = performance.now() - started
  const samples = window.__mdParseSamples
  window.__mdParseSamples = null
  active = false
  cancelAnimationFrame(animation)
  longTasks.push(...observer.takeRecords().map(entry => entry.duration))
  observer.disconnect()
  const percentile = (values, percent) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * percent))] ?? 0
  return {
    characters: content.length, updates: count, elapsedMs, redundantBurstParses,
    parseCalls: samples.length, parseMs: samples.reduce((sum, item) => sum + item.ms, 0),
    parseP95Ms: percentile(samples.map(item => item.ms), 0.95),
    frameP95Ms: percentile(frames, 0.95), maxFrameMs: Math.max(...frames),
    blockingMs: longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0),
    completed: document.querySelector('.markdown-content').textContent.endsWith('Delta ' + count + ' completed'),
    draftPreserved: draft.value === 'Keep this draft' && document.activeElement === draft,
    linkPreserved: !firstLink || firstLink === document.querySelector('.markdown-content a'),
    codePreserved: !firstCode || firstCode === document.querySelector('.code-highlight'),
    caretRemoved: !document.querySelector('.stream-caret'),
  }
}
window.benchReady = true
`)
  let instrumented = false
  await build({
    root: temporary,
    configFile: path.join(web, 'vite.config.ts'),
    logLevel: 'error',
    plugins: [{
      name: 'measure-markdown-parser',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('/react-markdown/lib/index.js')) return
        assert(code.includes('export function Markdown(options) {'), 'ReactMarkdown instrumentation needs updating')
        instrumented = true
        return code.replace('export function Markdown(options) {', 'function measuredMarkdown(options) {') + `
export function Markdown(options) {
  const start = performance.now()
  try { return measuredMarkdown(options) }
  finally { window.__mdParseSamples?.push({ ms: performance.now() - start }) }
}
`
      },
    }],
    build: { outDir, rollupOptions: { input: path.join(temporary, 'index.html') } },
  })
  assert(instrumented, 'Parser instrumentation did not run')
  server = await preview({ root: temporary, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  browser = await chromium.launch()
  for (const kind of (process.env.BENCH_CASES ?? 'plain,rich,large').split(',')) {
    for (const hz of (process.env.BENCH_HZ ?? '30,100').split(',').map(Number)) {
      for (let repeat = 0; repeat < repeats; repeat++) {
        const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
        await page.goto(server.resolvedUrls.local[0])
        await page.waitForFunction(() => window.benchReady)
        const result = await page.evaluate(options => window.benchStart(options), { kind, hz, durationMs })
        assert.equal(result.redundantBurstParses, Number(process.env.BENCH_EXPECT_BURST_PARSES ?? (baseline ? 20 : 0)), 'Unexpected parse work between display ticks')
        for (const key of ['completed', 'draftPreserved', 'linkPreserved', 'codePreserved', 'caretRemoved']) assert(result[key], `${kind} ${hz}Hz failed ${key}`)
        assert.deepEqual(errors, [])
        const sample = { version: baseline ?? 'working-tree', kind, hz, cpu, repeat, ...result }
        results.push(sample)
        console.log(JSON.stringify(sample))
        await page.close()
      }
    }
  }
  if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.httpServer.close(resolve))
  await rm(temporary, { recursive: true, force: true })
  await rm(outDir, { recursive: true, force: true })
}
