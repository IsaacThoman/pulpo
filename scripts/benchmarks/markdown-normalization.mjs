import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// No build or dependencies required: Node 22.13+ can strip this standalone module.
// Run without other CPU-heavy work. Both implementations run in this process.
const root = fileURLToPath(new URL('../../', import.meta.url))
const sourcePath = 'packages/client-core/src/markdown.ts'
const baseline = process.env.BENCH_BASE_REF ?? '08b2b232'
const samples = Number(process.env.BENCH_SAMPLES ?? 7)
assert(Number.isInteger(samples) && samples >= 3 && samples <= 30, 'BENCH_SAMPLES must be 3–30')

async function loadSource(source, name) {
  const javascript = stripTypeScriptTypes(source, { mode: 'strip' })
  return import(`data:text/javascript;base64,${Buffer.from(`${javascript}\n//# sourceURL=${name}`).toString('base64')}`)
}

const before = await loadSource(execFileSync('git', ['show', `${baseline}:${sourcePath}`], { cwd: root, encoding: 'utf8' }), 'markdown-before.js')
const after = await loadSource(await readFile(new URL(`../../${sourcePath}`, import.meta.url), 'utf8'), 'markdown-after.js')
const repeatTo = (unit, characters) => unit.repeat(Math.ceil(characters / unit.length)).slice(0, characters)
const plain = repeatTo('Pulpo keeps your conversations available while you explore a new idea.\n\n', 32_768)
const unicode = repeatTo('🦑 Café naïve — 数学の説明: x² + y². Ελληνικά e\u0301.\n\n', 32_768)
const paths = repeatTo(String.raw`Windows paths C:\\Users\\reader\\notes and regex \\d+\\s+\\w+ need escaping.` + '\n\n', 32_768)
const rich = repeatTo([
  '## A useful explanation', '', 'Text with **bold** and $x^2+y^2$; costs $5 today.',
  String.raw`Display \[\frac{x}{y} + z\] and inline \(a+b\).`,
  '- First item', '- Second item', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '',
  '```ts', String.raw`const path = "C:\\Users\\reader";`, '```', '',
  'See ![chart](https://example.test/chart.png).', '',
].join('\n'), 32_768)

const cases = [
  { name: 'plain-prose', category: 'representative', input: plain },
  { name: 'unicode-prose', category: 'representative', input: unicode },
  { name: 'escaped-paths-and-regex-prose', category: 'representative', input: paths },
  { name: 'rich-markdown', category: 'representative', input: rich },
  { name: 'complete-fenced-escape-code', category: 'stress-control', input: '```text\n' + '\\'.repeat(32_768) + '\n```' },
  { name: 'incomplete-fenced-escape-code', category: 'stress', input: '```text\n' + '\\'.repeat(32_768) },
  ...[2_048, 4_096, 8_192, 16_384, 32_768].map((length) => ({
    name: `backslash-run-${length}`, category: 'scaling-stress', input: '\\'.repeat(length),
  })),
]

function preprocess(implementation, source, platform) {
  const content = implementation.unwrapBoxedMinipages(source)
  return implementation.normalizeMathDelimiters(
    platform === 'mobile' ? implementation.linkMarkdownImages(content) : content,
    platform === 'mobile' ? { maxInlineMathLength: 24 } : { displayMathStyle: 'multiline' },
  )
}

// Compare outputs over every streaming prefix too, not just completed fixtures.
let equivalenceChecks = 0
for (const { input } of cases) {
  for (const platform of ['mobile', 'web']) {
    for (const prefix of [0, 1, 2, 3, 7, 31, 255, 1_023, Math.floor(input.length / 2), input.length - 1, input.length]) {
      assert.equal(preprocess(after, input.slice(0, prefix), platform), preprocess(before, input.slice(0, prefix), platform))
      equivalenceChecks += 1
    }
  }
}

// Deterministic delimiter mixtures exercise escapes, nested/unclosed blocks,
// currency, code boundaries and Unicode against the unchanged baseline.
let seed = 0x5eed1234
const tokens = ['\\', '\\', '[', ']', '(', ')', '$', '$$', 'x', ' ', '\n', '`', '```', '🦑', 'é', '![a](u)', String.raw`\begin{minipage}`]
for (let sample = 0; sample < 1_000; sample += 1) {
  let source = ''
  for (let index = 0; index < 80; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    source += tokens[seed % tokens.length]
  }
  for (const platform of ['mobile', 'web']) {
    assert.equal(preprocess(after, source, platform), preprocess(before, source, platform))
    equivalenceChecks += 1
  }
}

function measure(run, iterations) {
  const start = performance.now()
  let output
  for (let index = 0; index < iterations; index += 1) output = run()
  assert.equal(typeof output, 'string')
  return (performance.now() - start) / iterations
}

function summarize(values) {
  const ordered = [...values].sort((a, b) => a - b)
  return {
    medianMs: ordered[Math.floor(ordered.length / 2)],
    sampleP95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
    samplesMs: values,
  }
}

const results = []
for (const fixture of cases) {
  // Mobile includes image linking; web's different display-math setting is
  // covered by equivalence checks above. These are JS preprocessing timings.
  const runBefore = () => preprocess(before, fixture.input, 'mobile')
  const runAfter = () => preprocess(after, fixture.input, 'mobile')
  for (let warmup = 0; warmup < 3; warmup += 1) { runBefore(); runAfter() }
  // Calibrate each side separately so no-op fast paths still get a useful
  // timing window instead of measuring a handful of microsecond operations.
  const iterationsFor = (run) => Math.min(5_000, Math.max(1, Math.ceil(10 / Math.max(0.001, measure(run, 1)))))
  const iterations = { before: iterationsFor(runBefore), after: iterationsFor(runAfter) }
  const oldTimes = []; const newTimes = []
  for (let sample = 0; sample < samples; sample += 1) {
    if (sample % 2 === 0) {
      oldTimes.push(measure(runBefore, iterations.before)); newTimes.push(measure(runAfter, iterations.after))
    } else {
      newTimes.push(measure(runAfter, iterations.after)); oldTimes.push(measure(runBefore, iterations.before))
    }
  }
  const oldResult = summarize(oldTimes); const newResult = summarize(newTimes)
  const result = {
    name: fixture.name, category: fixture.category,
    utf16CodeUnits: fixture.input.length, utf8Bytes: Buffer.byteLength(fixture.input),
    iterationsPerSample: iterations, before: oldResult, after: newResult,
    medianSpeedup: oldResult.medianMs / newResult.medianMs,
  }
  results.push(result)
  console.log(`${fixture.name}: ${oldResult.medianMs.toFixed(3)} → ${newResult.medianMs.toFixed(3)} ms (${result.medianSpeedup.toFixed(2)}×)`)
}

const report = {
  timestamp: new Date().toISOString(), baseline,
  baselineCommit: execFileSync('git', ['rev-parse', baseline], { cwd: root, encoding: 'utf8' }).trim(),
  checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  environment: { node: process.version, os: `${os.type()} ${os.release()}`, architecture: os.arch(), cpu: os.cpus()[0]?.model },
  method: 'Same-process Node JS preprocessing; 3 warmups, alternating before/after sample order, independently calibrated iterations, full mobile normalization pipeline. Repeated warm identical-string measurements are a microbenchmark lower bound; no native rendering, browser layout or end-to-end latency is measured.',
  samples, equivalenceChecks, results,
}
if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, `${JSON.stringify(report, null, 2)}\n`)
else console.log(JSON.stringify(report, null, 2))
