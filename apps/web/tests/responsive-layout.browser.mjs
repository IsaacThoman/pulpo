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
  // People's tabs share a phone header with the drawer button, and their nav hides its scrollbar, so
  // a tab that doesn't fit is silently cut off. 60 friend + 60 Pool requests badge Friends "99+".
  await page.route('**/api/*/pending-count', (route) => route.fulfill({ json: { count: 60 } }))
  let peopleCases = 0
  for (const viewport of [320, 360, 375, 390, 640]) {
    for (const locale of ['en-US', 'es-ES']) {
      for (const path of ['/alexandria', '/friends', '/friends/leaderboard']) {
        await page.setViewportSize({ width: viewport, height: 720 })
        await page.goto(`${origin}tests/responsive/people.html?locale=${locale}&path=${path}`)
        await page.getByText('99+').waitFor()
        const header = await page.evaluate(async () => {
          // Measure with the app's font (Google Fonts' Inter), not a wider fallback.
          const faces = await Promise.all(['400 14px Inter', '500 14px Inter', '400 9px Inter'].map((font) => document.fonts.load(font, 'Clasificación 99+')))
          await new Promise(requestAnimationFrame)
          const nav = document.querySelector('nav')
          const last = nav.lastElementChild.getBoundingClientRect()
          return {
            inter: faces.every((loaded) => loaded.length > 0),
            drawerPadding: getComputedStyle(nav.parentElement).paddingLeft,
            slack: Math.round((nav.getBoundingClientRect().right - last.right) * 10) / 10,
            fits: nav.scrollWidth <= nav.clientWidth,
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
          }
        })
        assert.ok(header.inter, 'Inter must load from Google Fonts to measure the People header')
        assert.deepEqual({ ...header, slack: header.slack >= 0 }, { inter: true, drawerPadding: '48px', slack: true, fits: true, pageOverflow: false }, `${viewport}px ${locale} ${path} People header (slack ${header.slack}px)`)
        peopleCases++
      }
    }
  }
  // Someone else's profile swaps the tabs for a breadcrumb back to the tab it was opened from, beside
  // "Compare with friends". Phones keep the origin's name visible but drop the person's (their profile
  // heading follows) and collapse Compare to its icon: uncollapsed it overflows 320px by up to 74px.
  for (const viewport of [320, 360, 375, 390, 640]) {
    for (const locale of ['en-US', 'es-ES']) {
      for (const from of ['/friends', '/friends/leaderboard?scope=pool']) {
        await page.setViewportSize({ width: viewport, height: 720 })
        await page.goto(`${origin}tests/responsive/people.html?locale=${locale}&origin=${encodeURIComponent(from)}`)
        await page.locator('header a').first().waitFor()
        const header = await page.evaluate(async () => {
          const faces = await Promise.all(['400 14px Inter', '500 14px Inter'].map((font) => document.fonts.load(font, 'Clasificación Comparar')))
          await new Promise(requestAnimationFrame)
          const header = document.querySelector('header')
          const [back, compare] = header.querySelectorAll('a')
          const name = header.querySelector('[aria-current="page"]')
          const nameShown = name.getClientRects().length > 0
          const label = document.createRange()
          label.selectNodeContents([...back.childNodes].find((node) => node.nodeType === Node.TEXT_NODE))
          const backLabel = label.getBoundingClientRect()
          const lastCrumb = (nameShown ? name : back).getBoundingClientRect()
          return {
            inter: faces.every((loaded) => loaded.length > 0),
            drawerPadding: getComputedStyle(header).paddingLeft,
            slack: Math.round((compare.getBoundingClientRect().left - lastCrumb.right - 16) * 10) / 10,
            fits: [header, header.querySelector('nav'), back, compare].every((element) => element.scrollWidth <= element.clientWidth),
            backLabel: backLabel.width > 0 && backLabel.right <= back.getBoundingClientRect().right,
            nameShown,
            compareCollapsed: getComputedStyle(compare.querySelector('span')).position === 'absolute',
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
          }
        })
        assert.ok(header.inter, 'Inter must load from Google Fonts to measure the profile breadcrumb')
        const phone = viewport < 640
        assert.deepEqual(
          { ...header, slack: header.slack >= 0 },
          { inter: true, drawerPadding: '48px', slack: true, fits: true, backLabel: true, nameShown: !phone, compareCollapsed: phone, pageOverflow: false },
          `${viewport}px ${locale} ${from} profile breadcrumb (slack ${header.slack}px)`,
        )
        peopleCases++
      }
    }
  }
  assert.deepEqual(errors, [])
  console.log(`Passed ${cases} responsive table/stat/form cases, scrolling pagination, desktop visual parity, short dialog, phone popover, and ${peopleCases} People header and profile breadcrumb checks.`)
} finally {
  await browser?.close()
  await server.close()
}
