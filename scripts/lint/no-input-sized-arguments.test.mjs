import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const rule = 'pulpo/no-input-sized-arguments'
const plugin = fileURLToPath(new URL('./no-input-sized-arguments.mjs', import.meta.url))
const binary = fileURLToPath(new URL('../../node_modules/oxlint/bin/oxlint', import.meta.url))

test('argument-spread rule distinguishes dynamic arguments from literal and non-call spreads', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pulpo-argument-lint-'))
  try {
    const config = join(directory, 'config.json')
    writeFileSync(config, JSON.stringify({ jsPlugins: [{ name: 'pulpo', specifier: plugin }], rules: { [rule]: 'error' } }))
    const cases = [
      ['Math.max(...values)', 1],
      ['Math.min(0, ...values)', 1],
      ['Math["max"](...values)', 1],
      ['items.push(...values)', 1],
      ['items?.push(...values)', 1],
      ['items.push(...([1, ...values] as number[]))', 1],
      ['Math.max(...([1, 2] as const)); items.push(...[one, two])', 0],
      ['Math.min(1, 2); items.push(value); const copy = [...values]; const set = new Set([...values])', 0],
    ]
    for (const [source, count] of cases) {
      const file = join(directory, 'case.ts')
      writeFileSync(file, source)
      const result = spawnSync(process.execPath, [binary, '--config', config, '--disable-nested-config', '--format', 'json', file], { encoding: 'utf8' })
      assert.ok(result.status === 0 || result.status === 1, result.stderr)
      const output = JSON.parse(result.stdout)
      assert.equal(output.diagnostics.filter((diagnostic) => diagnostic.code?.includes('no-input-sized-arguments')).length, count, source)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
