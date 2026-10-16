import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { patchMeasurementCache, originalMeasurementCacheSource, HEADER } = require('./with-pulpo-markdown-cache.js')
const dependency = dirname(require.resolve('react-native-enriched-markdown/package.json'))
const original = originalMeasurementCacheSource(readFileSync(join(dependency, HEADER), 'utf8'))

describe('iOS Markdown measurement cache prebuild patch', () => {
  it('bounds both retained key copies in addition to the existing entry count', () => {
    const patched = patchMeasurementCache(original)
    expect(patched).toContain('static constexpr size_t kMaxEntries = 512;')
    expect(patched).toContain('static constexpr size_t kMaxMarkdownBytes = 8 * 1024 * 1024;')
    expect(patched).toContain('key.markdown.size() > kMaxMarkdownBytes / 2')
    expect(patched).toContain('key.markdown.size() * 2')
    expect(patched).toContain('while (!list_.empty() && (map_.size() >= kMaxEntries || keyBytes > kMaxMarkdownBytes - markdownBytes_))')
    expect(patched).toContain('markdownBytes_ -= lastEntry.key.markdown.size() * 2;')
    expect(patched).toContain('markdownBytes_ += keyBytes;')
    expect(patchMeasurementCache(patched)).toBe(patched)
    expect(originalMeasurementCacheSource(patched)).toBe(original)
  })

  it('rejects upstream drift anywhere in the original or previously patched header', () => {
    expect(() => patchMeasurementCache(original.replace('std::string markdown;', 'std::string markdown; // changed')))
      .toThrow(/update withPulpoMarkdownCache/)
    expect(() => patchMeasurementCache(patchMeasurementCache(original).replace('8 * 1024 * 1024', '16 * 1024 * 1024')))
      .toThrow(/update withPulpoMarkdownCache/)
    expect(() => patchMeasurementCache('class MeasurementCache {};')).toThrow(/update withPulpoMarkdownCache/)
  })

  it('explains how to recover from a header patched by a different plugin version', () => {
    const stale = patchMeasurementCache(original).replace('8 * 1024 * 1024', '16 * 1024 * 1024')
    expect(() => patchMeasurementCache(stale)).toThrow(/different Pulpo patch; reinstall react-native-enriched-markdown/)
    expect(() => patchMeasurementCache(original.replace('kMaxEntries = 512', 'kMaxEntries = 1024')))
      .not.toThrow(/reinstall/)
  })
})
