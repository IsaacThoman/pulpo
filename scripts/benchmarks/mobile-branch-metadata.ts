import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// The mobile workspace is CommonJS while shared packages expose ESM imports.
// Bundle the actual mobile modules as ESM before sampling, keeping packages external.
const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = await mkdtemp(path.join(root, 'node_modules/.branch-metadata-'))
try {
await build({
  entryPoints: {
    production: path.join(root, 'apps/mobile/src/mockup5/src/production/optimisticResponses.ts'),
    fixture: path.join(root, 'apps/mobile/e2e/performance/branch-metadata-fixture.ts'),
  },
  outdir: directory, outExtension: { '.js': '.mjs' },
  bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'error',
})
const { withBranchMetadata } = await import(pathToFileURL(path.join(directory, 'production.mjs')).href) as typeof import('../../apps/mobile/src/mockup5/src/production/optimisticResponses')
const { baselineBranchMetadata, branchCases, branchFixture, sampleSummary } = await import(pathToFileURL(path.join(directory, 'fixture.mjs')).href) as typeof import('../../apps/mobile/e2e/performance/branch-metadata-fixture')

const cases = []
for (const scenario of branchCases) {
  const rows = branchFixture(scenario.count, scenario.shape)
  assert.deepEqual(withBranchMetadata(rows), baselineBranchMetadata(rows))
  for (let warmup = 0; warmup < 3; warmup++) { baselineBranchMetadata(rows); withBranchMetadata(rows) }
  const before: number[] = [], after: number[] = []
  for (let sample = 0; sample < 9; sample++) {
    for (const [work, samples] of sample % 2
      ? [[withBranchMetadata, after], [baselineBranchMetadata, before]] as const
      : [[baselineBranchMetadata, before], [withBranchMetadata, after]] as const) {
      const start = performance.now()
      const result = work(rows)
      samples.push(performance.now() - start)
      assert.equal(result.length, rows.length)
    }
  }
  const result = { ...scenario, before: sampleSummary(before), after: sampleSummary(after) }
  cases.push(result)
  console.log(JSON.stringify(result))
}
const result = {
  timestamp: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  baseline: '08b2b232', method: 'Actual mobile withBranchMetadata versus frozen original, same process; 3 warmups then 9 alternating samples; fixture construction and full equality outside timing. JavaScript only, no React/native layout or network.', cases,
}
if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, `${JSON.stringify(result, null, 2)}\n`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
