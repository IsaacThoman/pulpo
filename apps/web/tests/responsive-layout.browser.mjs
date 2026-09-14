// Run with: npm run test:responsive -w @pulpo/web
// Install the browser once with: npx playwright install chromium
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const origin = server.resolvedUrls.local[0]
  let cases = 0
  for (const viewport of [320, 390, 640, 750, 900, 1280]) {
    for (const locale of ['en-US', 'es-ES']) {
      for (const columns of ['', '&user', '&balance', '&user&balance']) {
        await page.setViewportSize({ width: viewport, height: 720 })
        // At tablet widths, exercise the space remaining beside the 264px sidebar.
        const width = viewport >= 750 ? viewport - 264 : viewport
        await page.goto(`${origin}tests/responsive/index.html?width=${width}&locale=${locale}${columns}${locale === 'es-ES' ? '&dark' : ''}`)
        await page.locator('tbody tr').first().waitFor()
        const result = await page.evaluate(() => {
          const statOverflow = [...document.querySelectorAll('[data-testid=stats] > div > *')].some((cell) => cell.scrollWidth > cell.clientWidth + 1)
          const tables = [...document.querySelectorAll('table')].map((table) => {
            const heads = [...table.querySelectorAll('th')]
            const row = table.querySelector('tbody tr')
            if (!row) return false
            const cells = [...row.cells]
            return heads.length === cells.length && heads.every((head, i) => {
              const a = head.getBoundingClientRect(), b = cells[i].getBoundingClientRect()
              return Math.abs(a.x - b.x) < 1 && Math.abs(a.width - b.width) < 1 && cells[i].scrollWidth <= cells[i].clientWidth + 1
            })
          })
          const section = document.querySelector('section').getBoundingClientRect()
          const input = document.querySelector('input').getBoundingClientRect()
          return { statOverflow, tables, pageOverflow: document.documentElement.scrollWidth > innerWidth, fieldFits: input.left >= section.left && input.right <= section.right }
        })
        assert.deepEqual(result, { statOverflow: false, tables: [true, true], pageOverflow: false, fieldFits: true }, `${viewport}px ${locale} ${columns}`)
        for (const scroller of await page.getByRole('region').all()) {
          await scroller.evaluate((element) => { element.scrollTop = 100; element.scrollLeft = 180 })
          const aligned = await scroller.evaluate((element) => {
            const head = element.querySelector('th').getBoundingClientRect()
            const body = element.querySelector('td').getBoundingClientRect()
            return Math.abs(head.top - element.getBoundingClientRect().top) < 1 && Math.abs(head.left - body.left) < 1
          })
          assert.ok(aligned, 'Sticky headers must track horizontal and vertical scrolling')
        }
        const personal = page.getByRole('region').first()
        await personal.evaluate((element) => { element.scrollTop = element.scrollHeight })
        await page.waitForFunction(() => Number(document.querySelector('[data-testid="loads"]').textContent) > 0)
        cases++
      }
    }
  }
  // Preserve the pre-audit desktop design, not merely the absence of overflow.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}tests/responsive/index.html?width=1016&dark`)
  await page.locator('[data-testid=stats] > div').waitFor()
  const desktopStyle = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid=stats] > div')
    const reference = strip.cloneNode(true)
    reference.className = ''
    Object.assign(reference.style, { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '0px' })
    // Frozen original desktop strip: p-3, first:pl-0, last:pr-0, divide-x.
    for (const [index, cell] of [...reference.children].entries()) {
      cell.className = ''
      Object.assign(cell.style, { padding: '12px', paddingLeft: index === 0 ? '0px' : '12px', paddingRight: index === 4 ? '0px' : '12px', borderRight: index === 4 ? '0px' : '1px solid var(--border)' })
    }
    strip.parentElement.append(reference)
    const geometry = (element) => {
      const parent = element.getBoundingClientRect()
      return [...element.children].map((cell) => {
        const rect = cell.getBoundingClientRect(), style = getComputedStyle(cell)
        return [rect.x - parent.x, rect.width, rect.height, style.paddingLeft, style.paddingRight]
      })
    }
    const actual = geometry(strip), original = geometry(reference)
    const separators = [...strip.children].map((cell) => getComputedStyle(cell, '::before').borderLeftWidth)
    const gap = getComputedStyle(strip).columnGap
    reference.remove()
    return { actual, original, separators, gap }
  })
  assert.deepEqual(desktopStyle.actual, desktopStyle.original, 'Desktop stat spacing must match the original design')
  assert.deepEqual(desktopStyle.separators, Array(5).fill('1px'), 'Stat dividers must remain visible (row-start divider is clipped)')
  assert.equal(desktopStyle.gap, '0px')
  if (process.env.RESPONSIVE_SCREENSHOT) await page.locator('[data-testid=stats]').screenshot({ path: process.env.RESPONSIVE_SCREENSHOT })
  await page.setViewportSize({ width: 320, height: 360 })
  await page.getByRole('button', { name: 'Open tall dialog' }).click()
  const dialog = page.getByRole('dialog')
  const bounds = await dialog.boundingBox()
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 360, 'Dialog must fit short screens')
  await page.getByRole('button', { name: 'Finish dialog' }).click()
  await page.getByRole('button', { name: 'Open wide popover' }).click()
  const popover = await page.locator('[data-slot="popover-content"]').boundingBox()
  assert.ok(popover.x >= 0 && popover.x + popover.width <= 320, 'Wide pickers must fit phone screens')
  assert.deepEqual(errors, [])
  console.log(`Passed ${cases} responsive table/stat/form cases, scrolling pagination, desktop visual parity, short dialog, and phone popover checks.`)
} finally {
  await browser?.close()
  await server.close()
}
