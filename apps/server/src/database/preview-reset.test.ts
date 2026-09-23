import { describe, expect, it } from 'vitest'
import { migrationDrift, previewResetMode } from './preview-reset.js'

const migrations = [
  { tag: '0079_upstream', hash: 'a', folderMillis: 100 },
  { tag: '0080_upstream', hash: 'b', folderMillis: 200 },
  { tag: '0081_feature', hash: 'c', folderMillis: 400 },
]

describe('preview migration drift', () => {
  it('accepts fresh and up-to-date histories', () => {
    expect(migrationDrift([], migrations)).toBeNull()
    expect(migrationDrift([{ hash: 'a', createdAt: 100 }], migrations)).toBeNull()
    expect(migrationDrift([{ hash: 'a', createdAt: 100 }, { hash: 'b', createdAt: 200 }, { hash: 'c', createdAt: 400 }], migrations)).toBeNull()
  })

  it('detects an upstream migration skipped by a renumbered PR migration', () => {
    // The preview applied the feature as 0080 before dev claimed that number.
    expect(migrationDrift([{ hash: 'a', createdAt: 100 }, { hash: 'c', createdAt: 300 }], migrations))
      .toBe('0080_upstream is older than the newest applied migration but was never applied')
  })

  it('detects DDL that would replay under a later number', () => {
    const renumbered = [migrations[0]!, { tag: '0080_feature', hash: 'c', folderMillis: 400 }]
    expect(migrationDrift([{ hash: 'a', createdAt: 100 }, { hash: 'c', createdAt: 150 }], renumbered))
      .toBe('0080_feature was already applied under an earlier migration number')
  })

  it('detects a migration edited after the preview applied it', () => {
    expect(migrationDrift([{ hash: 'a', createdAt: 100 }, { hash: 'b-old', createdAt: 200 }], migrations))
      .toBe('0080_upstream is older than the newest applied migration but was never applied')
  })

  it('accepts histories repaired by the renumbered migration recovery', () => {
    // Recovery keeps the legacy row and records the renumbered migration again.
    expect(migrationDrift([{ hash: 'a', createdAt: 100 }, { hash: 'c', createdAt: 150 }, { hash: 'b', createdAt: 200 }, { hash: 'c', createdAt: 400 }], migrations)).toBeNull()
  })
})

describe('preview reset mode', () => {
  it('never applies outside Coolify previews', () => {
    expect(previewResetMode({})).toBeNull()
    expect(previewResetMode({ COOLIFY_BRANCH: 'dev' })).toBeNull()
    expect(previewResetMode({ COOLIFY_BRANCH: 'main', PULPO_PREVIEW_RESET_DATABASE: 'on_drift' })).toBeNull()
  })

  it('resets drifted previews unless turned off', () => {
    expect(previewResetMode({ COOLIFY_BRANCH: 'pull/672/head' })).toBe('on_drift')
    expect(previewResetMode({ COOLIFY_BRANCH: 'pull/672/head', PULPO_PREVIEW_RESET_DATABASE: 'never' })).toBe('never')
    expect(() => previewResetMode({ COOLIFY_BRANCH: 'pull/672/head', PULPO_PREVIEW_RESET_DATABASE: 'always' })).toThrow('on_drift or never')
  })
})
