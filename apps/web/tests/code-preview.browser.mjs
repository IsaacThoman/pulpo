// Run with: npm run test:code-preview -w @pulpo/web
// Pass --build to exercise the production bundle through `vite preview` instead of the dev server.
// Install the browser once with: npx playwright install chromium
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { build, createServer, preview } from 'vite'

const root = new URL('..', import.meta.url).pathname
const production = process.argv.includes('--build')
let server
let outDir
let browser
try {
  if (production) {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'pulpo-code-preview-'))
    await build({
      root,
      logLevel: 'error',
      build: {
        outDir,
        rollupOptions: { input: { fixture: `${root}tests/code-preview/index.html`, sandbox: `${root}sandbox.html` } },
      },
    })
    // Serve the sandbox with the production nginx headers, including the CSP `sandbox` directive.
    const nginx = await readFile(new URL('../../../deploy/nginx-static.conf', import.meta.url), 'utf8')
    const sandboxCsp = /location = \/sandbox\.html \{[^}]*add_header Content-Security-Policy "([^"]+)"/.exec(nginx)?.[1]
    assert.ok(sandboxCsp?.startsWith('sandbox allow-scripts'), 'nginx must serve the sandbox CSP')
    server = await preview({
      root,
      logLevel: 'error',
      build: { outDir },
      preview: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'sandbox-headers',
        configurePreviewServer(preview) {
          preview.middlewares.use((request, response, next) => {
            if (request.url?.split('?')[0] === '/sandbox.html') response.setHeader('Content-Security-Policy', sandboxCsp)
            next()
          })
        },
      }],
    })
  } else {
    server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
    await server.listen()
  }
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}tests/code-preview/index.html`)
  await page.getByRole('button', { name: 'Preview', exact: true }).first().waitFor()

  const panel = page.getByTestId('code-preview-panel')
  const open = async (index) => {
    await page.getByRole('button', { name: 'Preview', exact: true }).nth(index).click()
    await panel.getByTestId('sandbox-frame').waitFor()
    return page.frameLocator('[data-testid=sandbox-frame]')
  }
  const sandboxFrame = () => page.frames().find((frame) => frame.url().endsWith('/sandbox.html'))
  const frameResources = async () => sandboxFrame().evaluate(() => performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname))
  const optionalLibraries = /recharts|lucide|tailwind|index\.global/

  // A model-written game renders, runs, and only downloads React.
  const game = await open(0)
  await game.getByRole('heading', { name: 'Mains' }).waitFor()
  assert.equal(await game.getByRole('button', { name: /^Fitting, row/ }).count(), 9)
  await game.getByRole('button', { name: 'Fitting, row 1, column 1' }).click()
  await game.getByText('1 move').waitFor()
  const reactOnly = await frameResources()
  assert.deepEqual(reactOnly.filter((resource) => optionalLibraries.test(resource)), [], 'Mains must not load optional libraries')
  assert.equal(await panel.getByRole('heading').textContent(), 'Mains')

  // Imported libraries load on demand.
  const chart = await open(1)
  await chart.locator('.recharts-surface').waitFor()
  const chartResources = await frameResources()
  assert.ok(chartResources.some((resource) => !reactOnly.includes(resource)), 'recharts must load its own chunk')
  assert.ok(!chartResources.some((resource) => /lucide|tailwind|index\.global/.test(resource)))

  const badge = await open(2)
  await badge.locator('svg.lucide-zap').waitFor()
  // Tailwind's browser build styles utility classes.
  await sandboxFrame().waitForFunction(() => getComputedStyle(document.querySelector('[data-testid=badge]')).display === 'flex')

  // HTML runs scripts, but in an opaque origin with no access to Pulpo.
  const html = await open(3)
  await html.getByText(/"origin"/).waitFor()
  assert.deepEqual(JSON.parse(await html.locator('#out').textContent()), {
    origin: 'null', localStorage: 'blocked', cookie: 'blocked', parent: 'blocked',
  })

  const svg = await open(4)
  await svg.locator('#dot').waitFor()

  // Errors surface in the panel instead of failing silently.
  await open(5)
  await panel.getByRole('alert').filter({ hasText: 'Kaboom from preview' }).waitFor()
  await open(6)
  await panel.getByRole('alert').filter({ hasText: `"axios" isn't available in previews` }).waitFor()

  // The code view and close button work.
  await panel.getByRole('button', { name: 'Show code' }).click()
  await panel.getByText('import axios from "axios"').waitFor()
  await panel.getByRole('button', { name: 'Close preview' }).click()
  await panel.waitFor({ state: 'detached' })

  // Opened directly, the runner refuses to do anything.
  const direct = await page.goto(`${origin}sandbox.html`)
  if (production) assert.match(direct.headers()['content-security-policy'], /^sandbox allow-scripts /)
  assert.equal(await page.evaluate(() => document.body.textContent?.trim()), '')

  assert.deepEqual(errors, [])
  console.log(`Code preview ${production ? 'production' : 'development'} checks passed.`)
} finally {
  await browser?.close()
  await server?.close()
  if (outDir) await rm(outDir, { recursive: true, force: true })
}
