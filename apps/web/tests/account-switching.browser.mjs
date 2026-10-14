import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Uses registered, approved test accounts on a running local stack. Credentials
// come from PULPO_AUTH_FUZZ_ACCOUNTS=[{"email":"...","password":"..."},...].
// Optional PULPO_AUTH_FUZZ_ROUNDS adds seeded, two-tab switching after the race.
// No session tokens, screenshots, or raw network evidence are written to disk.
const base = new URL(process.env.PULPO_AUTH_FUZZ_URL ?? 'http://127.0.0.1:5173')
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a local test stack')
const credentials = JSON.parse(process.env.PULPO_AUTH_FUZZ_ACCOUNTS ?? '[]')
assert(credentials.length >= 2 && credentials.length <= 5, 'Supply two to five registered test accounts')
const rounds = Number(process.env.PULPO_AUTH_FUZZ_ROUNDS ?? 0)
const pause = Number(process.env.PULPO_AUTH_FUZZ_PAUSE_MS ?? 15000)
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const profile = p => p.evaluate(() => JSON.parse(localStorage.getItem('pulpo-profile') ?? 'null'))
const accountButton = (p, user) => p.locator('button[data-slot="dropdown-menu-trigger"]').filter({ hasText: `@${user.username}` })
const failures = []
const watchResponses = p => p.on('response', response => {
  if (response.url().includes('/api/') && response.status() >= 500) {
    failures.push({ path: new URL(response.url()).pathname, status: response.status() })
  }
})
watchResponses(page)
context.on('page', watchResponses)

async function login(p, credential) {
  await p.locator('#email').fill(credential.email)
  await p.locator('#password').fill(credential.password)
  const response = p.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST')
  await p.getByRole('button', { name: 'Sign in', exact: true }).click()
  const result = await response
  assert.equal(result.status(), 200, 'Test account login must succeed')
  const { user } = await result.json()
  assert(user.role === 'user' || user.role === 'admin', 'Test accounts must be approved')
  await accountButton(p, user).waitFor()
  return user
}

async function addAccount(p, user) {
  await accountButton(p, user).click()
  await p.getByRole('menuitem', { name: 'Add account', exact: true }).click()
  await p.waitForURL(new URL('/login', base).href, { waitUntil: 'domcontentloaded' })
}

async function serverState(p) {
  return p.evaluate(async () => {
    const me = await fetch('/api/me')
    const accounts = await fetch('/api/auth/accounts')
    return {
      meStatus: me.status, accountsStatus: accounts.status,
      userId: (await me.json()).user?.id,
      accountIds: (await accounts.json()).accounts?.map(account => account.id).sort(),
    }
  })
}

let releaseSessionCheck
try {
  // Finish the initial bootstrap before the control login.
  const startup = Promise.all(['/api/me', '/api/auth/settings', '/api/auth/setup-status'].map(path =>
    page.waitForResponse(response => new URL(response.url()).pathname === path)))
  await page.goto(new URL('/login', base).href)
  await startup
  const users = [await login(page, credentials[0])]
  for (const credential of credentials.slice(1)) {
    await page.waitForTimeout(pause)
    await addAccount(page, users.at(-1))
    users.push(await login(page, credential))
  }

  // Make room to sign in again, using the actual sign-out and fallback switch.
  await page.waitForTimeout(pause)
  await accountButton(page, users.at(-1)).click()
  const fallback = page.waitForResponse(response => response.url().endsWith('/api/auth/accounts/switch'))
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  const { user: survivor } = await (await fallback).json()
  await page.waitForURL(new URL('/', base).href)
  // The survivor becomes active after the full-page fallback switch finishes.
  await accountButton(page, survivor).waitFor()
  const survivorStartup = Promise.all(['/api/me', '/api/auth/settings', '/api/auth/setup-status'].map(path =>
    page.waitForResponse(response => new URL(response.url()).pathname === path)))
  await page.reload()
  await survivorStartup
  await accountButton(page, survivor).waitFor()

  const gate = new Promise(resolve => { releaseSessionCheck = resolve })
  let sessionCheckReady
  const captured = new Promise(resolve => { sessionCheckReady = resolve })
  await page.route('**/api/me', async route => {
    const response = await route.fetch()
    sessionCheckReady(response.status())
    await gate
    await route.fulfill({ response })
  }, { times: 1 })
  await addAccount(page, survivor)
  assert.equal(await captured, 401, 'Capture the real signed-out startup response')
  await page.waitForTimeout(1500)
  const signedIn = await login(page, credentials.at(-1))
  assert.equal((await profile(page))?.id, signedIn.id)
  releaseSessionCheck()
  await page.waitForTimeout(1000)
  const server = await serverState(page)
  const cached = await profile(page)
  console.log(JSON.stringify({ scenario: 'late-startup-401-after-login', serverAuthenticated: server.meStatus === 200,
    accounts: server.accountIds?.length, browserAuthenticated: cached?.id === signedIn.id }))
  assert.equal(server.meStatus, 200)
  assert.equal(server.userId, signedIn.id)
  assert.equal(server.accountIds.length, credentials.length)
  assert.equal(cached?.id, signedIn.id, 'An old bootstrap must not clear the successful login')
  await accountButton(page, signedIn).waitFor()

  if (rounds > 0) {
    const other = await context.newPage()
    await other.goto(new URL('/files', base).href)
    await accountButton(other, signedIn).waitFor()
    const tabs = [page, other]
    let seed = 877
    for (let round = 0; round < rounds; round++) {
      await page.waitForTimeout(pause)
      const p = tabs[round % tabs.length]
      const current = await profile(p)
      const candidates = users.filter(user => user.id !== current.id)
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const target = candidates[seed % candidates.length]
      await accountButton(p, current).click()
      await p.getByRole('menuitem', { name: `Switch to ${target.name}`, exact: true }).click()
      await accountButton(p, target).waitFor()
      if (round % 3 === 0) await p.reload()
      if (round % 3 === 1) await p.goto(new URL('/friends', base).href)
      if (round % 3 === 2) await p.goto(new URL('/usage', base).href)
      await accountButton(p, target).waitFor()
      await accountButton(tabs[(round + 1) % tabs.length], target).waitFor()
      const state = await serverState(p)
      assert.equal(state.meStatus, 200)
      assert.equal(state.userId, target.id)
      assert.deepEqual(state.accountIds, users.map(user => user.id).sort())
      console.log(JSON.stringify({ scenario: 'seeded-account-switch', round, tab: round % 2, accounts: state.accountIds.length }))
    }
  }
  assert.deepEqual(failures, [], 'Server failures can obscure account-switching results; increase the pause if rate limited')
} catch (error) {
  console.log(JSON.stringify({ url: page.url(), serverFailures: failures }))
  throw error
} finally {
  releaseSessionCheck?.()
  await browser.close()
}
