import { modelPreferencesPatchSchema, modelPreferencesSchema } from '@pulpo/contracts'

export function preferencesWithModelDefaults(values?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...values,
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
  return { ...patch, ...modelPatch }
}
