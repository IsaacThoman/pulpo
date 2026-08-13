import {
  automaticChatExpirationSchema,
  modelPreferencesPatchSchema,
  modelPreferencesSchema,
  newChatAutoExpireSchema,
  sidebarPinsSchema,
} from '@pulpo/contracts'

export function preferencesWithModelDefaults(values?: Record<string, unknown>): Record<string, unknown> {
  const parsedAutomaticChatExpiration = automaticChatExpirationSchema.safeParse(values?.automaticChatExpiration)
  const parsedNewChatAutoExpire = newChatAutoExpireSchema.safeParse(values?.newChatAutoExpire)
  return {
    ...values,
    automaticChatExpiration: parsedAutomaticChatExpiration.success ? parsedAutomaticChatExpiration.data : '24h',
    newChatAutoExpire: parsedNewChatAutoExpire.success ? parsedNewChatAutoExpire.data : false,
    sidebarPins: sidebarPinsSchema.parse(values?.sidebarPins ?? {}),
    ...modelPreferencesSchema.parse({
      favoriteModelIds: values?.favoriteModelIds,
      providerOrder: values?.providerOrder,
    }),
  }
}

export function normalizedPreferencePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const modelPatch = modelPreferencesPatchSchema.parse({
    ...('favoriteModelIds' in patch ? { favoriteModelIds: patch.favoriteModelIds } : {}),
    ...('providerOrder' in patch ? { providerOrder: patch.providerOrder } : {}),
  })
  const sidebarPins = 'sidebarPins' in patch ? sidebarPinsSchema.parse(patch.sidebarPins) : undefined
  return { ...patch, ...modelPatch, ...(sidebarPins ? { sidebarPins } : {}) }
}
