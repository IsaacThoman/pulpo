// Captures public/og-image.jpg, the link-preview image, from the landing page itself: the logo and
// headline above the hero demo's first scene, in the light theme. See docs/landing-screenshots.md.
// Start the web dev server first (npm run dev -w @pulpo/web), then run:
//   npm run capture:og-image -w @pulpo/web
// LANDING_URL overrides the page to capture (default http://localhost:5173/).
import { chromium } from 'playwright'

const landingUrl = process.env.LANDING_URL ?? 'http://localhost:5173/'
const outputPath = new URL('../public/og-image.jpg', import.meta.url).pathname
// The size declared by og:image:width and og:image:height in index.html.
const width = 1440
const height = 756

const browser = await chromium.launch()
try {
  // Reduced motion makes the demo hold each scene finished, so the capture doesn't depend on timing.
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light', reducedMotion: 'reduce', deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(landingUrl, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    await document.fonts.ready
    const demo = document.querySelector('main [role=img]')
    const headline = document.querySelector('main h1')?.textContent
    if (!demo || !headline) throw new Error('The landing page has no hero demo or headline')

    // A full-frame stage over the page, holding the brand, the headline, and the live demo moved out of the hero.
    const stage = document.createElement('div')
    stage.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:hidden;background:var(--background);color:var(--foreground);font-family:Inter,sans-serif'
    const glow = document.createElement('div')
    glow.style.cssText = 'position:absolute;left:14%;top:38%;width:72%;height:70%;border-radius:50%;background:oklch(0.86 0.17 98);opacity:0.16;filter:blur(110px)'
    const top = document.createElement('div')
    top.style.cssText = 'position:absolute;left:0;right:0;top:56px;display:flex;flex-direction:column;align-items:center;gap:22px'
    const brand = document.createElement('div')
    brand.style.cssText = 'display:flex;align-items:center;gap:16px'
    brand.innerHTML = '<img src="/pulpo-smiley.png" alt="" style="width:64px;height:64px"><span style="font-size:40px;font-weight:600;letter-spacing:-0.02em">Pulpo</span>'
    const title = document.createElement('div')
    title.textContent = headline
    title.style.cssText = 'font-size:56px;font-weight:600;letter-spacing:-0.025em'
    top.append(brand, title)
    // The demo's own glow is sized for the page, so the stage draws one of its own instead.
    demo.firstElementChild?.remove()
    demo.style.cssText = 'position:absolute;left:50%;top:268px;width:1180px;margin:0;padding:0;transform:translateX(-50%)'
    stage.append(glow, top, demo)
    document.body.append(stage)
    window.scrollTo(0, 0)
    await Promise.all([...stage.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined)))
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: outputPath, type: 'jpeg', quality: 88, scale: 'css', clip: { x: 0, y: 0, width, height } })
  console.log(`Wrote ${outputPath}`)
} finally {
  await browser.close()
}
