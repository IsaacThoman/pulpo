// Visual fidelity of the Word editor against LibreOffice. Opt-in; needs LibreOffice, Poppler
// (pdftoppm), and the Python venv from packages/client-core/scripts/docx-fidelity/README.md:
//   npm run test:docx-fidelity -w @pulpo/web
// Each fixture page is rendered in the harness and by LibreOffice (PDF at 96 dpi), and compared
// at quarter size: `similarity` is 1 − mean absolute grey difference, `ink` the overlap (IoU) of
// dark pixels. Scores go to stdout and to $FIDELITY_REPORT (JSON) when set. Both renderers use the
// metric-compatible fonts LibreOffice ships (Carlito for Calibri, Caladea for Cambria, …).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
const repo = new URL('../../..', import.meta.url).pathname
const python = process.env.PULPO_DOCX_PYTHON ?? '/tmp/pulpo-docx-venv/bin/python'
const fontsDir = '/Applications/LibreOffice.app/Contents/Resources/fonts/truetype'
const fixtures = join(repo, 'packages/client-core/fixtures/docx')
const files = (process.env.FIDELITY_FILES?.split(',') ?? readdirSync(fixtures).filter((name) => name.endsWith('.docx')))
const work = mkdtempSync(join(tmpdir(), 'pulpo-docx-visual-'))
const minimum = Number(process.env.FIDELITY_MINIMUM ?? 0.9)

const FONT_FACES = [
  ['Carlito', 'Carlito'], ['Caladea', 'Caladea'], ['Liberation Sans', 'LiberationSans'], ['Liberation Serif', 'LiberationSerif'], ['Liberation Mono', 'LiberationMono'],
].flatMap(([family, file]) => [['Regular', 400, 'normal'], ['Bold', 700, 'normal'], ['Italic', 400, 'italic'], ['BoldItalic', 700, 'italic']]
  .map(([style, weight, slant]) => `@font-face{font-family:"${family}";src:url(/__docx-fonts/${file}-${style}.ttf);font-weight:${weight};font-style:${slant}}`)).join('')

function libreOfficePages(file) {
  const outdir = mkdtempSync(join(work, 'lo-'))
  const result = spawnSync(python, ['-I', join(repo, 'packages/client-core/scripts/docx-fidelity/libreoffice.py'), file, '--outdir', outdir, '--png'], { encoding: 'utf8', timeout: 240_000 })
  if (result.status !== 0) throw new Error(`LibreOffice failed for ${file}: ${result.stdout}${result.stderr}`)
  return readdirSync(outdir, { recursive: true }).filter((name) => String(name).endsWith('.png')).sort((a, b) => {
    const number = (name) => Number(/-(\d+)\.png$/.exec(String(name))?.[1] ?? 0)
    return number(a) - number(b)
  }).map((name) => join(outdir, String(name)))
}

let server
let browser
const report = []
try {
  assert.ok(existsSync(fontsDir), 'LibreOffice is not installed')
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  await page.route('**/__docx-fonts/*', (route) => route.fulfill({ body: readFileSync(join(fontsDir, route.request().url().split('/').pop())), contentType: 'font/ttf' }))
  for (const name of files) {
    const references = libreOfficePages(join(fixtures, name))
    await page.goto(`${server.resolvedUrls.local[0]}tests/docx-editor/index.html?file=${encodeURIComponent(name)}&readonly=1`)
    await page.addStyleTag({ content: FONT_FACES })
    await page.waitForFunction(() => window.harness?.ready)
    await page.evaluate(async () => {
      await document.fonts.ready
      window.harness.editors[0].relayout()
    })
    await page.waitForTimeout(300)
    const sheets = page.locator('.docx-page')
    const count = await sheets.count()
    const scores = []
    for (let index = 0; index < Math.min(count, references.length); index++) {
      const ours = join(work, `${name}-${index + 1}-pulpo.png`)
      await sheets.nth(index).screenshot({ path: ours })
      const score = await page.evaluate(async ([a, b]) => {
        const load = (data) => new Promise((resolve) => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.src = `data:image/png;base64,${data}`
        })
        const [left, right] = await Promise.all([load(a), load(b)])
        const width = 204
        const height = Math.round((width * right.height) / right.width)
        const pixels = (image) => {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          context.fillStyle = '#fff'
          context.fillRect(0, 0, width, height)
          context.drawImage(image, 0, 0, width, height)
          const data = context.getImageData(0, 0, width, height).data
          const grey = new Float32Array(width * height)
          for (let index = 0; index < grey.length; index++) grey[index] = (data[index * 4] * 0.299 + data[index * 4 + 1] * 0.587 + data[index * 4 + 2] * 0.114)
          return grey
        }
        const x = pixels(left)
        const y = pixels(right)
        let difference = 0
        let both = 0
        let either = 0
        for (let index = 0; index < x.length; index++) {
          difference += Math.abs(x[index] - y[index])
          const inkX = x[index] < 200
          const inkY = y[index] < 200
          if (inkX && inkY) both++
          if (inkX || inkY) either++
        }
        return { similarity: 1 - difference / x.length / 255, ink: either ? both / either : 1 }
      }, [readFileSync(ours).toString('base64'), readFileSync(references[index]).toString('base64')])
      scores.push({ page: index + 1, similarity: Math.round(score.similarity * 1000) / 1000, ink: Math.round(score.ink * 1000) / 1000 })
    }
    report.push({ file: name, pages: { pulpo: count, libreoffice: references.length }, scores })
    const mean = scores.reduce((sum, score) => sum + score.similarity, 0) / Math.max(1, scores.length)
    console.log(`${name}: ${count} pages (LibreOffice ${references.length}); similarity ${mean.toFixed(3)}; ink ${scores.map((score) => score.ink).join(', ')}`)
  }
  if (process.env.FIDELITY_REPORT) writeFileSync(process.env.FIDELITY_REPORT, JSON.stringify(report, null, 2))
  console.log(`page images in ${work}`)
  for (const entry of report) {
    for (const score of entry.scores) assert.ok(score.similarity >= minimum, `${entry.file} page ${score.page}: similarity ${score.similarity} below ${minimum}`)
  }
} finally {
  await browser?.close()
  await server?.close()
}
