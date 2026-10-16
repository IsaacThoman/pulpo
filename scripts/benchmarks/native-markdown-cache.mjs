import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const { patchMeasurementCache, originalMeasurementCacheSource, HEADER, UPSTREAM_SHA256 } = require('../../apps/mobile/plugins/with-pulpo-markdown-cache.js')
const dependency = path.dirname(require.resolve('react-native-enriched-markdown/package.json'))
const upstream = originalMeasurementCacheSource(await readFile(path.join(dependency, HEADER), 'utf8'))
const patched = patchMeasurementCache(upstream)
const directory = await mkdtemp(path.join(os.tmpdir(), 'pulpo-markdown-cache-'))
const compiler = process.env.CXX ?? 'clang++'
const tsan = process.env.BENCH_TSAN === '1'
const testOnly = process.argv.includes('--test-only')
const samples = Number(process.env.BENCH_SAMPLES ?? 7)
assert(Number.isInteger(samples) && samples >= 3 && samples <= 30)

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
}
try {
  // These stubs satisfy platform includes only. The actual key/hash/LRU/cache
  // code is compiled unchanged from the dependency and the prebuild patch.
  // Separate include roots preserve upstream's React/react casing on macOS's
  // usual case-insensitive filesystem without suppressing compiler warnings.
  for (const dirname of ['CoreGraphics', 'platform/React', 'renderer/react/renderer/graphics']) await mkdir(path.join(directory, dirname), { recursive: true })
  await writeFile(path.join(directory, 'CoreGraphics/CGBase.h'), '#pragma once\nusing CGFloat = double;\n')
  await writeFile(path.join(directory, 'platform/React/RCTUtils.h'), '#pragma once\n')
  await writeFile(path.join(directory, 'renderer/react/renderer/graphics/Float.h'), '#pragma once\nnamespace facebook::react { using Float = float; }\n')
  const binaries = {}
  for (const [name, source] of [['before', upstream], ['after', patched]]) {
    const header = path.join(directory, `${name}.h`)
    const binary = path.join(directory, name)
    await writeFile(header, source)
    run(compiler, [
      '-std=c++20', tsan ? '-O1' : '-O2', '-pthread', '-Wall', '-Wextra', '-Werror',
      '-I', directory, '-I', path.join(directory, 'platform'), '-I', path.join(directory, 'renderer'), `-DMEASUREMENT_CACHE_HEADER="${header}"`,
      ...(name === 'after' ? ['-DCACHE_PATCHED=1'] : []),
      ...(tsan ? ['-fsanitize=thread', '-g'] : []),
      'scripts/benchmarks/native-markdown-cache.cpp', '-o', binary,
    ])
    binaries[name] = binary
    assert.equal(JSON.parse(run(binary, ['test'])).testsPassed, true)
  }
  console.log('Original/patched header tests passed (LRU, replacements, key identity, concurrency; patched byte-limit cases).')
  if (testOnly) process.exitCode = 0
  else {
    // Separate fresh processes make peak RSS attributable to each header.
    // Alternate sample order. Compiler work finishes before measurements start.
    const results = { before: [], after: [] }
    for (let sample = 0; sample < samples; sample += 1) {
      for (const name of sample % 2 ? ['after', 'before'] : ['before', 'after']) {
        results[name].push(JSON.parse(run(binaries[name], ['benchmark'])))
      }
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const summaries = Object.fromEntries(Object.entries(results).map(([name, rows]) => [name, {
      retainedEntries: rows[0].retainedEntries,
      retainedKeyTextBytes: rows[0].retainedKeyTextBytes,
      historicalCacheHits: rows[0].historicalCacheHits,
      medianPeakRssBytes: median(rows.map((row) => row.peakRssBytes)),
      medianInsertMilliseconds: median(rows.map((row) => row.insertMilliseconds)),
      samples: rows,
    }]))
    const report = {
      timestamp: new Date().toISOString(),
      dependencyVersion: JSON.parse(await readFile(path.join(dependency, 'package.json'), 'utf8')).version,
      upstreamHeaderSha256: UPSTREAM_SHA256,
      patchedHeaderSha256: createHash('sha256').update(patched).digest('hex'),
      environment: { os: `${os.type()} ${os.release()}`, architecture: os.arch(), cpu: os.cpus()[0]?.model, compiler: run(compiler, ['--version']).trim(), threadSanitizer: tsan },
      method: 'Actual dependency C++ header; platform includes stubbed, fresh process per sample, 512 growing 256–384KiB markdown prefixes, all measurement key dimensions constant. Retained bytes count both stored markdown strings; peak RSS is standalone process RSS, not app memory. Historical-prefix hits use lookups only, without reinserting misses.',
      samples, ...summaries,
    }
    if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
