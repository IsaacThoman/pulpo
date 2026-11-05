import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, OFFICE_2007_THEME } from '../../ooxml/theme.js'
import { parseChart } from './parse.js'
import { renderChartSvg } from './render.js'
import { fixture, fixtureResolver, testFormatNumber } from './test-data.js'

/**
 * Dev aid: with CHART_RENDER_OUT=/tmp/somewhere, writes every fixture's SVG there so it can be
 * looked at (e.g. `qlmanage -t -s 800 -o /tmp/out /tmp/somewhere/*.svg`). Without it, only checks
 * that every fixture renders.
 */
const out = process.env.CHART_RENDER_OUT

describe('fixture rendering', () => {
  const root = fileURLToPath(new URL('./__fixtures__/', import.meta.url))
  for (const folder of ['openpyxl', 'libreoffice', 'excel']) {
    for (const file of readdirSync(join(root, folder)).filter((name) => name.endsWith('.xml'))) {
      it(`${folder}/${file}`, () => {
        const model = parseChart(fixture(`${folder}/${file}`))
        expect(model.unsupported).toBe(false)
        const svg = renderChartSvg(model, {
          width: 480,
          height: 288,
          theme: folder === 'excel' ? DEFAULT_THEME : OFFICE_2007_THEME,
          resolveRange: folder === 'openpyxl' ? fixtureResolver : undefined,
          formatNumber: testFormatNumber,
          idPrefix: 'fixture',
        })
        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg).not.toContain('could not be drawn')
        if (out) {
          mkdirSync(out, { recursive: true })
          writeFileSync(join(out, `${folder}-${file.replace(/\.xml$/, '')}.svg`), svg)
        }
      })
    }
  }
})
