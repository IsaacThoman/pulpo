import { z } from 'zod'
import { CHAT_PRESET_ICON_NAMES } from './chat-preset-icons.generated.js'

/** Application setting key holding the instance's data retention tags. */
export const DATA_RETENTION_TAGS_SETTING_KEY = 'dataRetentionTags'
/** Model override that hides the provider's data retention tag. */
export const DATA_RETENTION_TAG_NONE = 'none'
export const MAX_DATA_RETENTION_TAGS = 20

const lucideIconNames = new Set<string>(CHAT_PRESET_ICON_NAMES)

export const dataRetentionTagIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .refine((id) => id !== DATA_RETENTION_TAG_NONE, 'This tag ID is reserved')

export const dataRetentionTagSchema = z.object({
  id: dataRetentionTagIdSchema,
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(500).default(''),
  icon: z.string().refine((icon) => lucideIconNames.has(icon), 'Unknown Lucide icon'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value such as #8b5cf6'),
})
export type DataRetentionTag = z.infer<typeof dataRetentionTagSchema>

export const dataRetentionTagsSchema = z.array(dataRetentionTagSchema).max(MAX_DATA_RETENTION_TAGS).superRefine((tags, context) => {
  const ids = new Set<string>()
  for (const [index, tag] of tags.entries()) {
    if (ids.has(tag.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Tag IDs must be unique' })
    ids.add(tag.id)
  }
})

/** Provider default: a tag ID, or null for no tag. */
export const providerDataRetentionTagIdSchema = dataRetentionTagIdSchema.nullable()
/** Model override: null follows the provider, `none` hides the provider's tag. */
export const modelDataRetentionTagIdSchema = z.union([dataRetentionTagIdSchema, z.literal(DATA_RETENTION_TAG_NONE)]).nullable()

export const DEFAULT_DATA_RETENTION_TAGS: readonly DataRetentionTag[] = [
  {
    id: 'zero-data-retention',
    name: 'Zero data retention',
    description: 'This provider does not store your prompts or responses after generating a reply.',
    icon: 'shield-check',
    color: '#8b5cf6',
  },
  {
    id: 'safety-retention-30d',
    name: '30-day safety retention',
    description: 'This provider may keep prompts and responses for up to 30 days for abuse and safety monitoring, then deletes them.',
    icon: 'shield',
    color: '#22c55e',
  },
  {
    id: 'other-retention',
    name: 'Other retention',
    description: "This provider's data retention differs from zero or 30-day retention. Check the provider's policy for details.",
    icon: 'shield-alert',
    color: '#f97316',
  },
]

/** Reads the stored setting; instances that never saved tags use the defaults. */
export function parseDataRetentionTags(value: unknown): DataRetentionTag[] {
  if (value === undefined || value === null) return DEFAULT_DATA_RETENTION_TAGS.map((tag) => ({ ...tag }))
  const parsed = dataRetentionTagsSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_DATA_RETENTION_TAGS.map((tag) => ({ ...tag }))
}

/** A model's tag overrides its provider's default; tags deleted since assignment resolve to none. */
export function resolveDataRetentionTag(
  tags: readonly DataRetentionTag[],
  providerTagId: string | null | undefined,
  modelTagId: string | null | undefined,
): DataRetentionTag | null {
  const id = modelTagId ?? providerTagId
  if (!id || id === DATA_RETENTION_TAG_NONE) return null
  return tags.find((tag) => tag.id === id) ?? null
}
