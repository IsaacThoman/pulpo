import {
  agentModesSchema,
  automaticChatExpirationSchema,
  modelPreferencesPatchSchema,
  modelPreferencesSchema,
  newChatAutoExpireSchema,
} from '@pulpo/contracts'

export function preferencesWithModelDefaults(values?: Record<string, unknown>): Record<string, unknown> {
  const parsedAutomaticChatExpiration = automaticChatExpirationSchema.safeParse(values?.automaticChatExpiration)
  const parsedNewChatAutoExpire = newChatAutoExpireSchema.safeParse(values?.newChatAutoExpire)
  const parsedAgentModes = agentModesSchema.safeParse(values?.agentModes)
  return {
    ...values,
    automaticChatExpiration: parsedAutomaticChatExpiration.success ? parsedAutomaticChatExpiration.data : '24h',
    newChatAutoExpire: parsedNewChatAutoExpire.success ? parsedNewChatAutoExpire.data : false,
    agentModes: parsedAgentModes.success ? parsedAgentModes.data : {},
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
  const agentModes = 'agentModes' in patch ? agentModesSchema.parse(patch.agentModes) : undefined
  return { ...patch, ...modelPatch, ...(agentModes === undefined ? {} : { agentModes }) }
}
