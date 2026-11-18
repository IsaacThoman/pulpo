#!/usr/bin/env node
// Fails on high or critical npm advisories, except reviewed entries in
// audit-exceptions.json. An exception stops applying after its review date,
// so each one must be re-checked rather than left in place indefinitely.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const failing = new Set(['high', 'critical'])
const exceptions = JSON.parse(readFileSync(new URL('./audit-exceptions.json', import.meta.url), 'utf8'))
const today = new Date().toISOString().slice(0, 10)
const active = new Map(exceptions.filter((entry) => entry.reviewBy >= today).map((entry) => [entry.id, entry]))
for (const entry of exceptions) if (!active.has(entry.id)) console.error(`Audit exception ${entry.id} expired on ${entry.reviewBy}; re-review it.`)

let output
try {
  output = execFileSync('npm', ['audit', '--json', ...process.argv.slice(2)], { encoding: 'utf8', maxBuffer: 64 * 1024 ** 2 })
} catch (error) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
  if (!error.stdout) throw error
  output = error.stdout
}
const report = JSON.parse(output)
if (report.error) throw new Error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`)

// Each vulnerable package lists its own advisories as objects in `via`; string
// entries only point at other vulnerable packages, so the advisories cover everything.
const advisories = new Map()
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== 'object' || !failing.has(via.severity)) continue
    const id = via.url?.split('/').pop() ?? String(via.source)
    const advisory = advisories.get(id) ?? { ...via, id, packages: new Set() }
    advisory.packages.add(vulnerability.name)
    advisories.set(id, advisory)
  }
}

const blocking = [...advisories.values()].filter((advisory) => !active.has(advisory.id))
for (const advisory of advisories.values()) {
  const exception = active.get(advisory.id)
  if (exception) console.log(`Allowed until ${exception.reviewBy}: ${advisory.id} (${advisory.severity}) ${advisory.title} - ${exception.reason}`)
}
for (const advisory of blocking) {
  console.error(`${advisory.severity.toUpperCase()}: ${advisory.id} ${advisory.title} in ${[...advisory.packages].join(', ')} (${advisory.range}) ${advisory.url}`)
}
for (const id of active.keys()) if (!advisories.has(id)) console.log(`Audit exception ${id} no longer matches any finding; remove it.`)
if (blocking.length) {
  console.error(`${blocking.length} high or critical advisories need remediation. See scripts/security/README.md.`)
  process.exitCode = 1
} else {
  console.log('No unreviewed high or critical advisories.')
}
