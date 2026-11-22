// Captures the media in the repository README from the landing page: the hero demo as a looping
// animation, the agent workspace still, and the framed app screenshots. Each has a light and a dark
// version on a transparent background. See "README media" in docs/landing-screenshots.md.
// Start the web dev server first (npm run dev -w @pulpo/web), then run:
//   npm run capture:readme-media -w @pulpo/web
// LANDING_URL overrides the page to capture (default http://localhost:5173/). Encoding needs cwebp and
// img2webp from libwebp on the PATH (brew install webp).
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const run = promisify(execFile)
const landingUrl = process.env.LANDING_URL ?? 'http://localhost:5173/'
const outputDir = new URL('../../../assets/readme/', import.meta.url).pathname

// The README column is about 850 CSS pixels wide, so these are sized to stay sharp on a dense display.
const DEMO = { width: 1152, scale: 1.25, frameMs: 80 }
const STILLS = [
  { name: 'workspace', selector: '#workspaces [role=img]', width: 720, scale: 2 },
  { name: 'apps', selector: '#apps [role=img]', width: 860, scale: 2 },
]
/** Room around each capture for the shadows the page draws outside an element's box. */
const PADDING = 32

/** Leaves only `selector` on a transparent page, `width` CSS pixels wide, and returns the area to capture. */
async function isolate(page, selector, width) {
  const size = await page.evaluate(async ({ selector, width, padding }) => {
    const target = document.querySelector(selector)
    if (!target) throw new Error(`The landing page has no ${selector}`)
    const stage = document.createElement('div')
    stage.style.cssText = `position:absolute;left:0;top:0;z-index:9999;box-sizing:content-box;width:${width}px;padding:${padding}px`
    target.style.margin = '0'
    target.style.maxWidth = 'none'
    target.style.width = '100%'
    stage.append(target)
    document.body.append(stage)
    document.querySelector('#root').style.display = 'none'
    for (const element of [document.documentElement, document.body]) element.style.background = 'transparent'
    await Promise.all([...stage.querySelectorAll('img')].map((image) => { image.loading = 'eager'; return image.decode().catch(() => undefined) }))
    await document.fonts.ready
    const box = stage.getBoundingClientRect()
    return { width: Math.ceil(box.width), height: Math.ceil(box.height) }
  }, { selector, width, padding: PADDING })
  await page.setViewportSize(size)
  return { x: 0, y: 0, ...size }
}

async function openLanding(browser, colorScheme, scale, { clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme, deviceScaleFactor: scale })
  const page = await context.newPage()
  // A clock the script advances itself, so every frame of the demo is a known moment of its loop.
  if (clock) await page.clock.install({ time: new Date('2026-01-01T09:41:00') })
  await page.goto(landingUrl, { waitUntil: 'networkidle' })
  return { context, page }
}

async function captureStill(browser, colorScheme, { name, selector, width, scale }) {
  const { context, page } = await openLanding(browser, colorScheme, scale)
  const frames = await mkdtemp(join(tmpdir(), 'pulpo-readme-'))
  try {
    const clip = await isolate(page, selector, width)
    const png = join(frames, `${name}.png`)
    await page.screenshot({ path: png, clip, omitBackground: true })
    const output = join(outputDir, `${name}-${colorScheme}.webp`)
    await run('cwebp', ['-quiet', '-q', '82', '-m', '6', '-sharp_yuv', '-alpha_q', '100', png, '-o', output])
    return output
  } finally {
    await context.close()
    await rm(frames, { recursive: true, force: true })
  }
}

async function captureDemo(browser, colorScheme) {
  const { context, page } = await openLanding(browser, colorScheme, DEMO.scale, { clock: true })
  const frames = await mkdtemp(join(tmpdir(), 'pulpo-readme-'))
  try {
    // The demo with its scene tabs, which caption what is playing.
    await page.evaluate(() => document.querySelector('main [role=img]')?.parentElement?.setAttribute('data-readme-demo', ''))
    const clip = await isolate(page, '[data-readme-demo]', DEMO.width)
    // Two changes keep the file small. Scenes cut instead of fading, since a fade repaints both screens on
    // every frame. And the playing scene's tab is underlined in full instead of filling up: the bar sits on
    // the transparent page, where a change on every frame makes the encoder store whole frames.
    await page.addStyleTag({ content: `
      .landing-device [style*="opacity"] { opacity: 1 !important }
      [data-readme-demo] [role=tab] > span > span { width: 0 !important }
      [data-readme-demo] [role=tab][aria-selected=true] > span > span { width: 100% !important }
    ` })
    await page.clock.pauseAt(new Date('2026-01-01T09:41:05'))
    await page.locator('[data-readme-demo] [role=tab]').first().click()

    let elapsed = 0
    let lastScene = 0
    const files = []
    for (;;) {
      const scene = await page.evaluate(async (elapsed) => {
        // Let React commit what the last step of the clock changed.
        for (let turn = 0; turn < 3; turn++) {
          await new Promise((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = resolve; channel.port2.postMessage(0) })
        }
        // CSS animations and transitions run on the real clock, so each is held at its place in the demo's time.
        const starts = (window.__readmeAnimationStarts ??= new WeakMap())
        for (const animation of document.getAnimations()) {
          if (!starts.has(animation)) starts.set(animation, elapsed)
          const at = elapsed - starts.get(animation)
          if (at >= (animation.effect?.getComputedTiming().endTime ?? Infinity)) animation.finish()
          else { animation.pause(); animation.currentTime = at }
        }
        return [...document.querySelectorAll('[data-readme-demo] [role=tab]')].findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
      }, elapsed)
      // Back at the first scene: the loop is complete.
      if (scene < lastScene) break
      lastScene = scene
      const file = join(frames, `${String(files.length).padStart(5, '0')}.png`)
      await page.screenshot({ path: file, clip, omitBackground: true })
      files.push(file)
      await page.clock.runFor(DEMO.frameMs)
      elapsed += DEMO.frameMs
    }

    const output = join(outputDir, `demo-${colorScheme}.webp`)
    await run('img2webp', ['-loop', '0', '-min_size', '-mixed', '-q', '75', '-m', '4', '-d', String(DEMO.frameMs), ...files, '-o', output], { maxBuffer: 64 * 1024 * 1024 })
    console.log(`  ${files.length} frames, ${((files.length * DEMO.frameMs) / 1000).toFixed(1)} s`)
    return output
  } finally {
    await context.close()
    await rm(frames, { recursive: true, force: true })
  }
}

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const colorScheme of ['light', 'dark']) {
    for (const output of [
      await captureDemo(browser, colorScheme),
      ...await Promise.all(STILLS.map((still) => captureStill(browser, colorScheme, still))),
    ]) console.log(`Wrote ${output} (${Math.round((await stat(output)).size / 1024)} KiB)`)
  }
} finally {
  await browser.close()
}
