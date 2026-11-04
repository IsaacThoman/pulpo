#!/usr/bin/env node
// Starts the converter inside its own image and converts every bundled sample through the HTTP
// API. CI runs it with the deployment's restrictions (read-only root, tmpfs, no network, no
// capabilities) to prove the service works under them.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixtures = process.env.OFFICE_CONVERTER_FIXTURES || '/opt/office-converter/fixtures'
const port = 18790
const token = randomBytes(24).toString('hex')
const base = `http://127.0.0.1:${port}`
const workDir = process.env.OFFICE_CONVERTER_WORK_DIR || '/tmp/office-converter'

const EDITABLE = {
  doc: 'docx', rtf: 'docx', odt: 'docx', ott: 'docx', wpd: 'docx', pages: 'docx', dotx: 'docx',
  xls: 'xlsx', ods: 'xlsx', ots: 'xlsx', numbers: 'xlsx', xltx: 'xlsx',
  ppt: 'pptx', pps: 'pptx', odp: 'pptx', otp: 'pptx', key: 'pptx', potx: 'pptx',
}
const ENCRYPTED = new Set(['password_tika_binaryrc4.doc', 'password.xls', 'Password_Protected-hello.ppt', 'bug53475-password-is-pass.docx'])

let failures = 0
function check(condition, message) {
  if (condition) return console.log(`ok   ${message}`)
  failures += 1
  console.log(`FAIL ${message}`)
}

const server = spawn(process.execPath, [process.env.OFFICE_CONVERTER_ENTRY || '/app/dist/index.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OFFICE_CONVERTER_TOKEN: token },
  stdio: ['ignore', 'inherit', 'inherit'],
})
const stop = () => server.kill('SIGTERM')

async function waitForHealth() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await fetch(`${base}/healthz`).catch(() => null)
    if (response?.ok) return
    if (server.exitCode !== null) throw new Error(`the converter exited with ${server.exitCode}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('the converter never became healthy')
}

async function convert(name, to, { body = readFileSync(join(fixtures, name)), auth = true } = {}) {
  const from = name.split('.').pop()
  const started = Date.now()
  const response = await fetch(`${base}/v1/convert?from=${from}&to=${to}`, {
    method: 'POST', body, headers: auth ? { authorization: `Bearer ${token}` } : {},
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { status: response.status, bytes, ms: Date.now() - started, json: () => JSON.parse(Buffer.from(bytes).toString('utf8')) }
}

const magic = (bytes) => Buffer.from(bytes.subarray(0, 5)).toString('latin1')

/** Linux only; elsewhere (a developer's Mac) the check is skipped. */
function lingeringOffice() {
  if (process.platform !== 'linux') return []
  return readdirSync('/proc').filter((entry) => /^\d+$/.test(entry)).filter((pid) => {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('soffice')
    } catch {
      return false
    }
  })
}

/** Processes that exited but were never reaped (state Z). Linux only. */
function zombies() {
  if (process.platform !== 'linux') return []
  return readdirSync('/proc').filter((entry) => /^\d+$/.test(entry)).filter((pid) => {
    try {
      return /^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
    } catch {
      return false
    }
  })
}

try {
  await waitForHealth()
  check(true, 'converter became healthy')
  for (const name of readdirSync(fixtures).sort()) {
    const extension = name.split('.').pop()
    if (ENCRYPTED.has(name)) {
      const result = await convert(name, 'pdf')
      check(result.status === 422 && result.json().error.code === 'encrypted', `${name} is reported as password-protected (${result.status})`)
      continue
    }
    const to = EDITABLE[extension]
    if (to) {
      const result = await convert(name, to)
      check(result.status === 200 && magic(result.bytes).startsWith('PK') && result.bytes.length > 1_000, `${name} -> .${to} (${result.status}, ${result.bytes.length} bytes, ${result.ms} ms)`)
    }
    const pdf = await convert(name, 'pdf')
    check(pdf.status === 200 && magic(pdf.bytes) === '%PDF-', `${name} -> .pdf (${pdf.status}, ${pdf.bytes.length} bytes, ${pdf.ms} ms)`)
  }

  const html = await convert('page.doc', 'docx', { body: Buffer.from('<html><img src="http://example.com/x.png"></html>') })
  check(html.status === 415 && html.json().error.code === 'unexpected_content', 'HTML named .doc is refused')
  const anonymous = await convert('SampleDoc.doc', 'docx', { auth: false })
  check(anonymous.status === 401, 'requests without the token are refused')

  const parallel = await Promise.all(['SampleDoc.doc', 'SampleSS.xls', 'basic_test_ppt_file.ppt', 'sample.docx'].map((name) => convert(name, 'pdf')))
  check(parallel.every((result) => result.status === 200 && magic(result.bytes) === '%PDF-'), 'four simultaneous conversions succeed')

  // A client that goes away mid-conversion has its job killed; nothing may be left behind,
  // not even zombies (tini, PID 1 in the image, reaps the orphans).
  const cancelled = new AbortController()
  const abandoned = fetch(`${base}/v1/convert?from=key&to=pdf`, {
    method: 'POST', body: readFileSync(join(fixtures, 'keynote5-file.key')), headers: { authorization: `Bearer ${token}` }, signal: cancelled.signal,
  }).catch(() => null)
  await new Promise((resolve) => setTimeout(resolve, 400))
  cancelled.abort()
  await abandoned
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  check(zombies().length === 0, `no zombie processes are left (${zombies().join(', ') || 'none'})`)

  await new Promise((resolve) => setTimeout(resolve, 500))
  check(lingeringOffice().length === 0, 'no LibreOffice process outlives its job')
  check(readdirSync(workDir).filter((entry) => entry.startsWith('job-')).length === 0, 'job directories are removed')
} catch (error) {
  failures += 1
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`)
} finally {
  stop()
}

if (failures) {
  console.log(`${failures} smoke check(s) failed`)
  process.exit(1)
}
console.log('Office converter smoke test passed.')
