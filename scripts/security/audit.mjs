import { spawnSync } from 'node:child_process'

const advisoryId = 'GHSA-fc5q-39xc-vjpf'
const advisoryUrl = `https://github.com/advisories/${advisoryId}`
const audit = spawnSync('npm', ['audit', '--audit-level=high', '--json'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (audit.error) throw audit.error
if (audit.status !== 0 && audit.status !== 1) {
  throw new Error(`npm audit failed (${audit.signal ?? audit.status}).`)
}

const report = JSON.parse(audit.stdout)
if (report.auditReportVersion !== 2 || report.error || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
  throw new Error(`Unexpected npm audit report: ${JSON.stringify(report.error ?? report)}`)
}

// String entries in "via" point to other affected packages. The objects
// describe the advisories themselves and can appear under multiple packages.
const advisories = Object.values(report.vulnerabilities)
  .flatMap(({ via }) => via.filter((entry) => typeof entry === 'object'))
for (const { severity, title, url } of new Map(advisories.map((advisory) => [advisory.url, advisory])).values()) {
  console.log(`${severity}: ${title} (${url})`)
}
const counts = report.metadata.vulnerabilities
console.log(`${counts.total} vulnerabilities (${counts.low} low, ${counts.moderate} moderate, ${counts.high} high, ${counts.critical} critical)`)

if (audit.status === 1) {
  process.exitCode = 1
  const blocking = advisories.filter(({ severity }) => severity === 'high' || severity === 'critical')
  // npm can still report this withdrawn advisory while its feed catches up.
  if (counts.critical === 0 && blocking.length > 0 && blocking.every(({ name, url, severity }) =>
    name === 'picomatch' && url === advisoryUrl && severity === 'high'
  )) {
    const headers = { Accept: 'application/vnd.github+json' }
    if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`
    const response = await fetch(`https://api.github.com/advisories/${advisoryId}`, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Could not verify ${advisoryId} withdrawal (HTTP ${response.status}).`)
    const advisory = await response.json()
    if (advisory.ghsa_id === advisoryId && typeof advisory.withdrawn_at === 'string'
      && Number.isFinite(Date.parse(advisory.withdrawn_at))) {
      console.log(`GitHub withdrew ${advisoryId} at ${advisory.withdrawn_at}. This is the only blocking advisory in npm's report.`)
      process.exitCode = 0
    }
  }
}
