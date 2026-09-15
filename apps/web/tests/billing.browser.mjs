// Run with: node apps/web/tests/billing.browser.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const server = await createServer({ root: new URL('..', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
let browser
try {
  await server.listen(); browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const summary = { plan: 'baby', planOverridden: false, balanceMicros: 12000000, availableBalanceMicros: 11000000, balancePendingMicros: 1000000,
    poolBalanceMicros: null, poolBalancePendingMicros: null, availablePoolBalanceMicros: null, weekly: null, fiveHour: null, onHold: false, subscription: null,
    payments: [{ id: 'in_qa', kind: 'credits', automatic: true, requestedCreditCents: 2500, amountCents: 2885, taxCents: 200, status: 'paid', createdAt: '2026-09-15T10:00:00Z' }],
    autoTopUp: { enabled: true, thresholdCents: 500, creditCents: 2500, monthlyLimitCents: 10000, revision: 0, card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
      chargedCents: 8655, pendingCents: 0, processing: false, resetsAt: '2026-10-01T00:00:00Z', status: 'limit_reached' },
  }
  await page.route('**/api/billing/summary', route => route.fulfill({ json: summary }))
  await page.route('**/api/billing/credit-quote', route => route.fulfill({ json: { creditCents: 2500, chargeCents: 2685 } }))
  for (const width of [320, 390, 1280]) for (const locale of ['en-US', 'es-ES']) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(`${server.resolvedUrls.local[0]}tests/billing/index.html?locale=${locale}${locale === 'es-ES' ? '&dark' : ''}`)
    const configure = page.getByRole('button', { name: locale === 'en-US' ? 'Configure top-ups' : 'Configurar recargas' })
    await configure.waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} ${locale}: page overflow`)
    await configure.focus(); await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog'); await dialog.waitFor()
    await page.getByRole('checkbox').focus(); await page.keyboard.press('Space')
    assert.equal(await page.getByRole('checkbox').isChecked(), true)
    const fits = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && element.scrollWidth <= element.clientWidth + 1
    })
    assert.ok(fits, `${width} ${locale}: dialog overflow`)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(element => element === document.activeElement, await configure.elementHandle(), { timeout: 3000 })
    if (process.env.BILLING_SCREENSHOT_DIR && locale === 'en-US' && width !== 320) await page.screenshot({ path: `${process.env.BILLING_SCREENSHOT_DIR}/billing-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('Billing layout and keyboard checks passed: 6 viewport/locale combinations')
} finally { await browser?.close(); await server.close() }
