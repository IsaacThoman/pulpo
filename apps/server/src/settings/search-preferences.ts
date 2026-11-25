import {
  defaultSearchAccountPreferences, SEARCH_ACCOUNT_PREFERENCES_KEY, searchRegions, validateSearchCustomBang,
  type SearchAccountPreferences,
} from '@pulpo/contracts/search'
import { z } from 'zod'

const provider = z.enum(['kagi', 'firecrawl'])
const fallbackProvider = z.union([provider, z.enum(['none', ''])])
const providerChoice = z.strictObject({ defaultProvider: provider, fallbackProvider })
const domainRule = z.enum(['pin', 'hide'])
const customBang = z.strictObject({
  trigger: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,23}$/),
  name: z.string().min(1).max(80),
  url: z.string().max(2_048),
}).refine(bang => validateSearchCustomBang(bang) === null, 'Enter an HTTPS shortcut URL with {query} in its path or query string.')

const preferences = z.strictObject({
  defaultProvider: z.union([provider, z.literal('')]),
  fallbackProvider,
  categoryProviders: z.strictObject({
    news: providerChoice.optional(),
    images: providerChoice.optional(),
    videos: providerChoice.optional(),
    podcasts: providerChoice.optional(),
  }),
  limit: z.literal([10, 20, 40]),
  newTab: z.boolean(),
  keyboardShortcuts: z.boolean(),
  localPlaces: z.boolean(),
  defaultRegion: z.enum(searchRegions.map(([value]) => value)),
  safeSearch: z.boolean(),
  domains: z.record(z.string().min(1).max(253), domainRule)
    .refine(rules => Object.keys(rules).length <= 100, 'Save up to 100 site preferences.'),
  bangs: z.array(customBang).max(30),
})

export const searchPreferencesAccountQuery = z.object({ accountId: z.uuid() })
export const searchPreferencesUpdate = searchPreferencesAccountQuery.extend({
  patch: preferences.partial(),
  initial: preferences.optional(),
}).strict()

export function savedSearchPreferences(values: Record<string, unknown> | undefined): SearchAccountPreferences | null {
  const saved = values?.[SEARCH_ACCOUNT_PREFERENCES_KEY]
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null
  const parsed = preferences.safeParse({ ...defaultSearchAccountPreferences, ...saved })
  if (parsed.success) return parsed.data
  // A field written by another release shouldn't discard the rest of the account's Search settings.
  const stored = saved as Record<string, unknown>
  return preferences.parse(Object.fromEntries(Object.entries(preferences.shape).map(([field, schema]) => {
    const value = Object.hasOwn(stored, field) ? schema.safeParse(stored[field]) : undefined
    return [field, value?.success ? value.data : defaultSearchAccountPreferences[field as keyof SearchAccountPreferences]]
  })))
}
