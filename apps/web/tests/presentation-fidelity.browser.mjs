// Visual fidelity of the presentation renderer against LibreOffice. Opt-in (needs LibreOffice,
// poppler, and the Python venv described in packages/client-core/test-tools/presentation):
//   PULPO_OFFICE_FIDELITY=1 node tests/presentation-fidelity.browser.mjs [deck ...]
// Renders every slide of each deck in the harness at 1280 px, renders LibreOffice references,
// scores each pair with image_similarity.py, writes a report (and side-by-side diffs) to
// $PULPO_FIDELITY_OUT (default /tmp/pulpo-pptx-fidelity), and fails below loose thresholds.
// LibreOffice is a reference, not ground truth: fonts differ (no Calibri here), and it re-routes
// connectors; the thresholds leave room for that and catch missing or misplaced content.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

if (process.env.PULPO_OFFICE_FIDELITY !== '1') {
  console.log('Set PULPO_OFFICE_FIDELITY=1 to run the visual fidelity check.')
  process.exit(0)
}
const root = new URL('..', import.meta.url).pathname
const tools = new URL('../../../packages/client-core/test-tools/presentation/', import.meta.url).pathname
const fixtures = new URL('../../../packages/client-core/fixtures/presentation/', import.meta.url).pathname
const python = process.env.PULPO_PPTX_PYTHON ?? '/tmp/pulpo-pptx-venv/bin/python'
const out = process.env.PULPO_FIDELITY_OUT ?? '/tmp/pulpo-pptx-fidelity'
const decks = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['generated/autoshapes.pptx', 'generated/text-formatting.pptx', 'generated/tables.pptx', 'generated/charts.pptx', 'generated/pictures.pptx', 'generated/theme-custom.pptx', 'generated/two-masters.pptx', 'generated/layouts-notes-sections.pptx', 'poi/shapes.pptx', 'poi/SmartArt.pptx', 'poi/backgrounds.pptx', 'poi/layouts.pptx', 'poi/table-with-theme.pptx', 'poi/bar-chart.pptx', 'poi/pie-chart.pptx', 'poi/minimal-gradient-fill-issue.pptx']
mkdirSync(out, { recursive: true })

let server
let browser
const report = []
try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  for (const deck of decks) {
    const stem = deck.replace(/[/.]/g, '-')
    const referenceDir = join(out, `${stem}-reference`)
    if (!existsSync(referenceDir) || !readdirSync(referenceDir).some((file) => file.endsWith('.png'))) {
      execFileSync('bash', [join(tools, 'render_reference.sh'), join(fixtures, deck), referenceDir, '--width', '1280', '--hidden-slides'], { stdio: 'ignore', env: { ...process.env, PULPO_PPTX_PYTHON: python } })
    }
    const references = readdirSync(referenceDir).filter((file) => file.endsWith('.png')).sort()
    await page.goto(`${server.resolvedUrls.local[0]}tests/presentation-editor/index.html?deck=${deck}&show=0`)
    await page.locator('.pp-canvas .pp-slide').first().waitFor()
    await page.waitForTimeout(500)
    const count = await page.evaluate(() => window.harness.controllers.a.slideKeys().length)
    for (let index = 0; index < count; index++) {
      // One slide at a time at exactly 1280 px wide, images loaded.
      await page.evaluate((slideIndex) => {
        const controller = window.harness.controllers.a
        const key = controller.slideKeys()[slideIndex]
        let host = document.getElementById('fidelity')
        if (!host) {
          host = document.createElement('div')
          host.id = 'fidelity'
          host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:white'
          document.body.append(host)
        }
        const size = controller.size()
        const scale = 1280 / size.width
        host.style.width = '1280px'
        host.style.height = `${size.height * scale}px`
        host.innerHTML = `<div style="transform:scale(${scale});transform-origin:0 0">${controller.slideHtml(key, 'view', `fidelity-${slideIndex}`)}</div>`
      }, index)
      await page.waitForTimeout(150)
      await page.evaluate(() => Promise.all([...document.querySelectorAll('#fidelity image')].map((image) => new Promise((resolve) => (image.complete ? resolve() : setTimeout(resolve, 300))))))
      const ours = join(out, `${stem}-${index + 1}.png`)
      await page.locator('#fidelity').screenshot({ path: ours })
      const reference = references[index]
      if (!reference) {
        report.push({ deck, slide: index + 1, error: 'no reference' })
        continue
      }
      const score = JSON.parse(execFileSync(python, ['-I', join(tools, 'image_similarity.py'), ours, join(referenceDir, reference), '--diff', join(out, `${stem}-${index + 1}-diff.png`)], { encoding: 'utf8' }))
      report.push({ deck, slide: index + 1, ...score })
    }
  }
} finally {
  await browser?.close()
  await server?.close()
}

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
const scored = report.filter((entry) => entry.similarity !== undefined)
const average = (key) => scored.reduce((sum, entry) => sum + entry[key], 0) / scored.length
console.log(report.map((entry) => `${entry.deck} #${entry.slide}: ${entry.error ?? `similarity ${entry.similarity.toFixed(3)} structure ${entry.structure.toFixed(3)}`}`).join('\n'))
console.log(`\n${scored.length} slides: mean similarity ${average('similarity').toFixed(3)}, mean structure ${average('structure').toFixed(3)}. Report: ${join(out, 'report.json')}`)
assert.ok(average('structure') >= 0.93, 'mean structural similarity')
for (const entry of scored) assert.ok(entry.structure >= 0.8, `${entry.deck} slide ${entry.slide} structure ${entry.structure}`)
