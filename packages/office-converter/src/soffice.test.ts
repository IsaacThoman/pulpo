import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TargetFormat } from './formats.js'
import { ConversionError, convertWithSoffice, prepareTemplateProfile, runSoffice, type SofficeOptions } from './soffice.js'
import { linkedImageDocument, linkedSectionDocument, macroDocument } from './testing/hostile-documents.js'

/** LibreOffice, if this machine has it. The image's CI sets OFFICE_CONVERTER_REQUIRE_SOFFICE so it cannot be skipped there. */
function findSoffice(): string | null {
  if (process.env.OFFICE_CONVERTER_SOFFICE) return process.env.OFFICE_CONVERTER_SOFFICE
  const mac = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  if (existsSync(mac)) return mac
  try {
    return execFileSync('sh', ['-c', 'command -v soffice'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

const soffice = findSoffice()
if (!soffice && process.env.OFFICE_CONVERTER_REQUIRE_SOFFICE) throw new Error('LibreOffice is required for these tests')

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

/** The visible text of an Office Open XML file's first content part. */
function ooxmlText(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const part = files['word/document.xml'] ?? files['xl/sharedStrings.xml'] ?? files['ppt/slides/slide1.xml']
  if (!part) throw new Error(`No content part among ${Object.keys(files).join(', ')}`)
  return new TextDecoder().decode(part).replace(/<[^>]+>/g, ' ').replace(/&apos;/g, "'").replace(/\s+/g, ' ')
}

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'

describe('process control', () => {
  let directory: string
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'office-converter-process-')) })
  afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

  /** A stand-in for soffice that starts helpers, records their pids, and never finishes. */
  async function hangingSoffice(): Promise<{ path: string; pids: string }> {
    const pids = join(directory, `pids-${Date.now()}`)
    const path = join(directory, `hang-${Date.now()}.sh`)
    await writeFile(path, `#!/bin/sh\nsleep 300 &\necho $! >> '${pids}'\nsh -c 'sleep 300' &\necho $! >> '${pids}'\necho $$ >> '${pids}'\nwait\n`)
    await chmod(path, 0o755)
    return { path, pids }
  }

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async function waitForPids(file: string, count: number): Promise<number[]> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pids = existsSync(file) ? (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(Number) : []
      if (pids.length >= count) return pids
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('helpers never started')
  }

  it('kills the whole process tree when a job times out', async () => {
    const fake = await hangingSoffice()
    const started = Date.now()
    const result = await runSoffice({ sofficePath: fake.path, timeoutMs: 500 }, directory, [])
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(5_000)
    const pids = await waitForPids(fake.pids, 3)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(pids.filter(alive)).toEqual([])
  })

  it('kills the whole process tree when the request is cancelled', async () => {
    const fake = await hangingSoffice()
    const controller = new AbortController()
    const running = runSoffice({ sofficePath: fake.path, timeoutMs: 60_000 }, directory, [], controller.signal)
    const pids = await waitForPids(fake.pids, 3)
    controller.abort()
    expect((await running).aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(pids.filter(alive)).toEqual([])
  })

  it('passes no service environment to LibreOffice', async () => {
    const script = join(directory, 'env.sh')
    await writeFile(script, `#!/bin/sh\nenv\n`)
    await chmod(script, 0o755)
    process.env.OFFICE_CONVERTER_TOKEN_PROBE = 'must-not-leak'
    try {
      const result = await runSoffice({ sofficePath: script, timeoutMs: 5_000 }, directory, [])
      expect(result.output).toContain(`HOME=${directory}`)
      expect(result.output).not.toContain('must-not-leak')
    } finally {
      delete process.env.OFFICE_CONVERTER_TOKEN_PROBE
    }
  })
})

describe.skipIf(!soffice)('LibreOffice conversions', () => {
  let options: SofficeOptions
  let template: string
  beforeAll(async () => {
    options = { sofficePath: soffice!, workRoot: await mkdtemp(join(tmpdir(), 'office-converter-test-')), timeoutMs: 90_000, maxOutputBytes: 50 * 1024 * 1024 }
    template = await prepareTemplateProfile(options)
  }, 180_000)
  afterAll(async () => { await rm(options.workRoot, { recursive: true, force: true }) })

  const convert = (name: string, to: TargetFormat, input: Uint8Array = fixture(name)) =>
    convertWithSoffice(options, template, { input, from: name.split('.').pop()!, to })

  async function conversionError(name: string, to: TargetFormat, input?: Uint8Array): Promise<string> {
    try {
      await convert(name, to, input)
    } catch (error) {
      if (error instanceof ConversionError) return error.code
      throw error
    }
    return 'converted'
  }

  it.each([
    ['SampleDoc.doc', 'docx', 'This is page two'],
    ['SampleDoc.rtf', 'docx', 'This is page two'],
    ['SampleDoc.odt', 'docx', 'This is page two'],
    ['SampleDoc.ott', 'docx', 'This is page two'],
    ['WP6.wpd', 'docx', 'Foo foo'],
    ['pages5-file.pages', 'docx', 'My hovercraft is full of eels'],
    ['test.dotx', 'docx', 'Test'],
    ['SampleSS.xls', 'xlsx', 'Start of 2nd sheet'],
    ['SampleSS.ods', 'xlsx', 'Start of 2nd sheet'],
    ['SampleSS.ots', 'xlsx', 'Start of 2nd sheet'],
    ['numbers3-file.numbers', 'xlsx', 'automatic text'],
    ['test.xltx', 'xlsx', 'test'],
    ['basic_test_ppt_file.ppt', 'pptx', 'This is a test subtitle'],
    ['basic_test_ppt_file.pps', 'pptx', 'This is a test subtitle'],
    ['basic_test_ppt_file.odp', 'pptx', 'This is a test subtitle'],
    ['basic_test_ppt_file.otp', 'pptx', 'This is a test subtitle'],
    ['basic_test_ppt_file.potx', 'pptx', 'This is a test subtitle'],
    ['keynote5-file.key', 'pptx', 'Title slide'],
  ] as const)('converts %s to .%s keeping its text', async (name, to, text) => {
    expect(ooxmlText(await convert(name, to))).toContain(text)
  }, 90_000)

  it.each(['sample.docx', 'SampleSS.xls', 'basic_test_ppt_file.ppt', 'pages5-file.pages'])('exports %s as PDF', async (name) => {
    expect(isPdf(await convert(name, 'pdf'))).toBe(true)
  }, 90_000)

  it('reports password-protected files', async () => {
    expect(await conversionError('password_tika_binaryrc4.doc', 'docx')).toBe('encrypted')
    expect(await conversionError('bug53475-password-is-pass.docx', 'pdf')).toBe('encrypted')
    expect(await conversionError('password.xls', 'xlsx')).toBe('encrypted')
  }, 180_000)

  it('opens encrypted files that use the format\'s default password', async () => {
    expect(isPdf(await convert('protected_agile.docx', 'pdf'))).toBe(true)
  }, 90_000)

  it('refuses content that does not match its name before starting LibreOffice', async () => {
    const html = new TextEncoder().encode('<html><body><img src="http://127.0.0.1:9/x.png">hi</body></html>')
    expect(await conversionError('page.doc', 'docx', html)).toBe('unexpected_content')
  })

  it('reports damaged files', async () => {
    const damaged = fixture('SampleDoc.odt').slice(0, 2_000)
    expect(await conversionError('SampleDoc.odt', 'docx', damaged)).toBe('conversion_failed')
  }, 90_000)

  it('runs several jobs at once, each with its own profile, and leaves nothing behind', async () => {
    const outputs = await Promise.all([convert('SampleDoc.doc', 'docx'), convert('SampleSS.xls', 'xlsx'), convert('basic_test_ppt_file.ppt', 'pptx'), convert('sample.docx', 'pdf')])
    expect(ooxmlText(outputs[0]!)).toContain('This is page two')
    expect(ooxmlText(outputs[1]!)).toContain('Start of 2nd sheet')
    expect(ooxmlText(outputs[2]!)).toContain('This is a test subtitle')
    expect(isPdf(outputs[3]!)).toBe(true)
    expect((await readdir(options.workRoot)).filter((name) => name.startsWith('job-'))).toEqual([])
  }, 180_000)

  it('stops a conversion that exceeds its time limit', async () => {
    const quick = { ...options, timeoutMs: 50 }
    await expect(convertWithSoffice(quick, template, { input: fixture('SampleDoc.doc'), from: 'doc', to: 'pdf' })).rejects.toMatchObject({ code: 'timeout' })
  }, 30_000)

  it('refuses output above the size limit', async () => {
    const tiny = { ...options, maxOutputBytes: 100 }
    await expect(convertWithSoffice(tiny, template, { input: fixture('SampleDoc.doc'), from: 'doc', to: 'pdf' })).rejects.toMatchObject({ code: 'output_too_large' })
  }, 90_000)

  // Headless LibreOffice 26.8 does none of these even with its default settings; these guard the
  // locked profile against regressions in LibreOffice or in the settings themselves.
  describe('untrusted content', () => {
    let directory: string
    beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'office-converter-hostile-')) })
    afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

    it('does not run document macros', async () => {
      const marker = join(directory, 'macro-ran')
      const input = macroDocument(marker)
      for (const to of ['docx', 'pdf'] as const) await convertWithSoffice(options, template, { input, from: 'odt', to })
      expect(existsSync(marker)).toBe(false)
    }, 180_000)

    it('does not pull local text files into the output through RTF fields', async () => {
      const secret = join(directory, 'token.txt')
      await writeFile(secret, 'PULPO-RTF-SECRET')
      const path = secret.replace(/\\/g, '/')
      const rtf = new TextEncoder().encode(`{\\rtf1\\ansi Visible {\\field{\\*\\fldinst INCLUDETEXT "${path}"}{\\fldrslt cached}} and {\\field{\\*\\fldinst INCLUDEPICTURE "${path}" \\\\d}{\\fldrslt}}}`)
      const docx = await convertWithSoffice(options, template, { input: rtf, from: 'rtf', to: 'docx' })
      const files = unzipSync(docx)
      const everything = Object.values(files).map((bytes) => new TextDecoder().decode(bytes)).join('\n')
      expect(ooxmlText(docx)).toContain('Visible')
      expect(everything).not.toContain('PULPO-RTF-SECRET')
    }, 120_000)

    it('does not fetch linked images or update links to local files', async () => {
      let requests = 0
      const server = createServer((_request, response) => { requests += 1; response.end() })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      try {
        const secret = join(directory, 'secret.txt')
        await writeFile(secret, 'PULPO-SECRET-CONTENT')
        const image = linkedImageDocument(`http://127.0.0.1:${(server.address() as AddressInfo).port}/pixel.png`)
        const section = linkedSectionDocument(pathToFileURL(secret).href, 'cached section text')
        for (const to of ['docx', 'pdf'] as const) {
          await convertWithSoffice(options, template, { input: image, from: 'odt', to })
          const converted = await convertWithSoffice(options, template, { input: section, from: 'odt', to })
          if (to === 'docx') {
            expect(ooxmlText(converted)).toContain('cached section text')
            expect(ooxmlText(converted)).not.toContain('PULPO-SECRET-CONTENT')
          }
        }
        expect(requests).toBe(0)
      } finally {
        server.close()
      }
    }, 240_000)
  })
})
