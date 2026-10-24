import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATA_RETENTION_TAGS,
  dataRetentionTagsSchema,
  modelDataRetentionTagIdSchema,
  parseDataRetentionTags,
  resolveDataRetentionTag,
} from './data-retention.js'

const [zeroRetention, safetyRetention] = DEFAULT_DATA_RETENTION_TAGS

describe('data retention tags', () => {
  it('defaults to zero, 30-day safety, and other retention in purple, green, and orange', () => {
    expect(parseDataRetentionTags(undefined).map(({ id, icon, color }) => ({ id, icon, color }))).toEqual([
      { id: 'zero-data-retention', icon: 'shield-check', color: '#8b5cf6' },
      { id: 'safety-retention-30d', icon: 'shield', color: '#22c55e' },
      { id: 'other-retention', icon: 'shield-alert', color: '#f97316' },
    ])
  })

  it('keeps an admin-saved empty list instead of restoring the defaults', () => {
    expect(parseDataRetentionTags([])).toEqual([])
  })

  it('accepts any Lucide icon and rejects unknown icons, bad colors, and duplicate IDs', () => {
    const tag = { id: 'custom', name: 'Custom', description: '', icon: 'shield-question-mark', color: '#123abc' }
    expect(dataRetentionTagsSchema.safeParse([tag]).success).toBe(true)
    expect(dataRetentionTagsSchema.safeParse([{ ...tag, icon: 'not-an-icon' }]).success).toBe(false)
    expect(dataRetentionTagsSchema.safeParse([{ ...tag, color: 'purple' }]).success).toBe(false)
    expect(dataRetentionTagsSchema.safeParse([tag, tag]).success).toBe(false)
    expect(dataRetentionTagsSchema.safeParse([{ ...tag, id: 'none' }]).success).toBe(false)
  })

  it('resolves a model override before the provider default', () => {
    const tags = parseDataRetentionTags(undefined)
    expect(resolveDataRetentionTag(tags, zeroRetention!.id, null)).toEqual(zeroRetention)
    expect(resolveDataRetentionTag(tags, zeroRetention!.id, safetyRetention!.id)).toEqual(safetyRetention)
    expect(resolveDataRetentionTag(tags, zeroRetention!.id, 'none')).toBeNull()
    expect(resolveDataRetentionTag(tags, null, null)).toBeNull()
    expect(resolveDataRetentionTag(tags, 'deleted-tag', null)).toBeNull()
    expect(modelDataRetentionTagIdSchema.parse('none')).toBe('none')
  })
})
