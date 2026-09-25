// Captures the landing page screenshots in public/landing/. See docs/landing-screenshots.md.
// Run with: npm run capture:landing -w @pulpo/web [-- --demo-profile] [--hero <chatId>]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values: args } = parseArgs({ options: { hero: { type: 'string' }, 'demo-profile': { type: 'boolean' } } })
const origin = process.env.PULPO_URL ?? 'https://pulpo.baby'
const outputDirectory = new URL('../public/landing/', import.meta.url).pathname
const ogImagePath = new URL('../public/og-image.jpg', import.meta.url).pathname
const profile = { name: 'Alex Rivera', username: 'alex' }
const heroPrompt = 'Explain how KV caching speeds up transformer decoding. Include a short PyTorch snippet and the memory cost formula.'
// Oldest first so the sidebar reads naturally with the hero chat on top.
const sidebarPrompts = [
  'Plan a relaxed 3-day weekend in Lisbon on a budget',
  "Draft a friendly reminder email about Friday's design review",
  'What is the derivative of x^x? Show the steps.',
  'Suggest five names for a cozy neighborhood coffee shop',
  'Compare mixture-of-experts and dense language models in a short table',
  'Summarize the main causes of the 1929 stock market crash',
  'Write a haiku about debugging at 2am',
]

try {
  execFileSync('cwebp', ['-version'], { stdio: 'ignore' })
} catch {
  throw new Error('cwebp is required (brew install webp)')
}

async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    return { ok: response.ok, status: response.status, json: await response.json().catch(() => null) }
  }, { method, path, body })
}

async function enableAgent(page) {
  const disabled = page.getByRole('button', { name: 'Agent options, Disabled' })
  if (!await disabled.count()) return
  await disabled.first().click()
  await page.getByRole('menuitemradio', { name: 'Pulpo Agent' }).click()
  await page.keyboard.press('Escape')
}

async function send(page, prompt) {
  await page.goto(origin)
  const composer = page.getByPlaceholder('Message…')
  await composer.waitFor()
  await composer.fill(prompt)
  await composer.press('Enter')
  await page.waitForURL(/\/c\//, { timeout: 30_000 })
  const stop = page.getByLabel('Stop generating')
  await stop.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  await stop.waitFor({ state: 'hidden', timeout: 300_000 })
  await page.waitForTimeout(1500)
  console.log(`Created ${page.url()}`)
  return new URL(page.url()).pathname.split('/').pop()
}

const profileDirectory = mkdtempSync(join(tmpdir(), 'pulpo-landing-'))
const context = await chromium.launchPersistentContext(profileDirectory, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
try {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(`${origin}/login`)
  console.log(`Sign in to ${origin} in the browser window. Waiting up to 10 minutes…`)
  const deadline = Date.now() + 10 * 60_000
  while (!(await api(page, 'GET', '/api/me').catch(() => ({ ok: false }))).ok) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for sign-in')
    await page.waitForTimeout(2000)
  }

  // Renames the signed-in account, so it is opt-in and meant for disposable accounts.
  if (args['demo-profile']) {
    const updated = await api(page, 'PATCH', '/api/me', profile)
    if (!updated.ok) throw new Error(`Could not update the demo profile (${updated.status})`)
  }

  let heroChatId = args.hero
  if (!heroChatId) {
    const existing = await api(page, 'GET', '/api/chats')
    if (existing.json?.data?.length) console.log('Account already has chats; skipping sidebar demo chats.')
    else for (const prompt of sidebarPrompts) await send(page, prompt)
    heroChatId = await send(page, heroPrompt)
  }
  // Accounts can expire new chats automatically; keep the hero chat and hide its hourglass.
  const kept = await api(page, 'PATCH', `/api/chats/${heroChatId}`, { autoExpire: false })
  if (!kept.ok) throw new Error(`Could not turn off expiry for chat ${heroChatId} (${kept.status})`)
  // Give the app's local cache time to pick up the change before capturing.
  await page.waitForTimeout(5000)

  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto(`${origin}/c/${heroChatId}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(2500)
    await enableAgent(page)
    // Show the start of the conversation rather than its end.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll('*')) {
        if (element.clientHeight > 400 && element.scrollHeight > element.clientHeight + 50 && getComputedStyle(element).overflowY !== 'visible') element.scrollTop = 0
      }
    })
    await page.mouse.move(1, 1)
    await page.waitForTimeout(800)
    const png = join(profileDirectory, `chat-${scheme}.png`)
    await page.screenshot({ path: png })
    const webp = join(outputDirectory, `chat-${scheme}.webp`)
    execFileSync('cwebp', ['-quiet', '-q', '80', '-m', '6', '-resize', '2400', '0', png, '-o', webp])
    console.log(`Wrote ${webp}`)
    if (scheme === 'dark') {
      // Link-preview image referenced by og:image in index.html (1.91:1).
      await page.screenshot({ path: ogImagePath, type: 'jpeg', quality: 85, scale: 'css', clip: { x: 0, y: 0, width: 1440, height: 756 } })
      console.log(`Wrote ${ogImagePath}`)
    }
  }
} finally {
  await context.close()
  rmSync(profileDirectory, { recursive: true, force: true })
}
