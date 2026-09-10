import {
  imageGenerationPreferencesSchema,
  speechPreferencesSchema,
  agentModesSchema,
  animationSpeedSchema,
  automaticChatExpirationSchema,
  instructionPresetSelectionsSchema,
  modelPreferencesPatchSchema,
  modelPreferencesSchema,
  newChatAutoExpireSchema,
  sidebarPinsSchema,
} from '@pulpo/contracts'

export function preferencesWithModelDefaults(values?: Record<string, unknown>): Record<string, unknown> {
  const parsedAnimationSpeed = animationSpeedSchema.safeParse(values?.animationSpeed)
  const parsedAutomaticChatExpiration = automaticChatExpirationSchema.safeParse(values?.automaticChatExpiration)
  const parsedNewChatAutoExpire = newChatAutoExpireSchema.safeParse(values?.newChatAutoExpire)
  const parsedAgentModes = agentModesSchema.safeParse(values?.agentModes)
  const parsedInstructionPresetSelections = instructionPresetSelectionsSchema.safeParse(values?.instructionPresetSelections)
  return {
    ...values,
    imageGeneration: imageGenerationPreferencesSchema.catch({ enabled: false, modelId: null }).parse(values?.imageGeneration),
    speech: speechPreferencesSchema.catch({ modelId: null, models: {} }).parse(values?.speech),
    animationSpeed: parsedAnimationSpeed.success ? parsedAnimationSpeed.data : animationSpeedSchema.parse(undefined),
    automaticChatExpiration: parsedAutomaticChatExpiration.success ? parsedAutomaticChatExpiration.data : '24h',
    newChatAutoExpire: parsedNewChatAutoExpire.success ? parsedNewChatAutoExpire.data : false,
    sidebarPins: sidebarPinsSchema.parse(values?.sidebarPins ?? {}),
    agentModes: parsedAgentModes.success ? parsedAgentModes.data : {},
    instructionPresetSelections: parsedInstructionPresetSelections.success ? parsedInstructionPresetSelections.data : {},
    ...modelPreferencesSchema.parse({
      favoriteModelIds: values?.favoriteModelIds,
      providerOrder: values?.providerOrder,
    }),
  }
}

export function normalizedPreferencePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const animationSpeed = 'animationSpeed' in patch ? animationSpeedSchema.parse(patch.animationSpeed) : undefined
  const modelPatch = modelPreferencesPatchSchema.parse({
    ...('favoriteModelIds' in patch ? { favoriteModelIds: patch.favoriteModelIds } : {}),
    ...('providerOrder' in patch ? { providerOrder: patch.providerOrder } : {}),
  })
  const sidebarPins = 'sidebarPins' in patch ? sidebarPinsSchema.parse(patch.sidebarPins) : undefined
  const agentModes = 'agentModes' in patch ? agentModesSchema.parse(patch.agentModes) : undefined
  const instructionPresetSelections = 'instructionPresetSelections' in patch
    ? instructionPresetSelectionsSchema.parse(patch.instructionPresetSelections)
    : undefined
  return {
    ...patch,
    ...('imageGeneration' in patch ? { imageGeneration: imageGenerationPreferencesSchema.parse(patch.imageGeneration) } : {}),
    ...('speech' in patch ? { speech: speechPreferencesSchema.parse(patch.speech) } : {}),
    ...(animationSpeed === undefined ? {} : { animationSpeed }),
    ...modelPatch,
    ...(sidebarPins === undefined ? {} : { sidebarPins }),
    ...(agentModes === undefined ? {} : { agentModes }),
    ...(instructionPresetSelections === undefined ? {} : { instructionPresetSelections }),
  }
}
