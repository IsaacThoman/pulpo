import { readFileSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { looksEncrypted, readZipEntry } from './encryption.js'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

function odfPackage(manifest: string): Uint8Array {
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'META-INF/manifest.xml': strToU8(manifest),
    'content.xml': strToU8('<office:document-content/>'),
  })
}

/** A tiny deterministic generator so failures reproduce. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

describe('password-protected documents', () => {
  it.each([
    'password_tika_binaryrc4.doc', // Word 97 RC4
    'password.xls', // Excel 97 FILEPASS
    'Password_Protected-hello.ppt', // PowerPoint 97 encrypted summary
    'protected_agile.docx', // Office Open XML agile encryption, default password
    'bug53475-password-is-pass.docx', // Office Open XML standard encryption
  ])('recognizes %s', (name) => {
    expect(looksEncrypted(fixture(name))).toBe(true)
  })

  it.each(['SampleDoc.doc', 'SimpleMacro.doc', 'SampleSS.xls', 'basic_test_ppt_file.ppt', 'sample.docx', 'SampleSS.ods', 'SampleDoc.odt', 'pages5-file.pages', 'WP6.wpd', 'SampleDoc.rtf'])(
    'does not flag %s',
    (name) => {
      expect(looksEncrypted(fixture(name))).toBe(false)
    },
  )

  it('reads an OpenDocument manifest for encryption data', () => {
    const plain = '<manifest:manifest><manifest:file-entry manifest:full-path="content.xml"/></manifest:manifest>'
    const encrypted = '<manifest:manifest><manifest:file-entry manifest:full-path="content.xml"><manifest:encryption-data manifest:checksum-type="SHA1/1K"/></manifest:file-entry></manifest:manifest>'
    expect(looksEncrypted(odfPackage(plain))).toBe(false)
    expect(looksEncrypted(odfPackage(encrypted))).toBe(true)
    expect(new TextDecoder().decode(readZipEntry(odfPackage(plain), 'META-INF/manifest.xml')!)).toBe(plain)
  })

  it('caps how much of a zip member it inflates', () => {
    const bomb = zipSync({ 'META-INF/manifest.xml': new Uint8Array(4 * 1024 * 1024) })
    expect(readZipEntry(bomb, 'META-INF/manifest.xml')).toBeNull()
    expect(looksEncrypted(bomb)).toBe(false)
  })

  it('never throws on truncated, corrupted, or random input', () => {
    const next = random(7)
    const samples = [fixture('password_tika_binaryrc4.doc'), fixture('password.xls'), fixture('protected_agile.docx'), odfPackage('encryption-data')]
    for (const sample of samples) {
      for (let cut = 0; cut < sample.length; cut += Math.max(1, Math.floor(sample.length / 97))) {
        expect(() => looksEncrypted(sample.subarray(0, cut))).not.toThrow()
      }
      for (let round = 0; round < 200; round += 1) {
        const mutated = sample.slice()
        for (let flips = 0; flips < 16; flips += 1) mutated[Math.floor(next() * mutated.length)] = Math.floor(next() * 256)
        expect(typeof looksEncrypted(mutated)).toBe('boolean')
      }
    }
    for (let round = 0; round < 200; round += 1) {
      const bytes = Uint8Array.from({ length: Math.floor(next() * 4096) }, () => Math.floor(next() * 256))
      bytes.set([0xd0, 0xcf, 0x11, 0xe0], 0)
      expect(typeof looksEncrypted(bytes)).toBe('boolean')
    }
  })
})
