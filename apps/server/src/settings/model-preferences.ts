import {
  imageGenerationPreferencesSchema,
  speechPreferencesSchema,
  agentModesSchema,
  animationSpeedSchema,
  automaticChatExpirationSchema,
  chatSortModeSchema,
  fileDoubleClickActionSchema,
  instructionPresetSelectionsSchema,
  modelPreferencesPatchSchema,
  modelPreferencesSchema,
  modelWarningDismissalsSchema,
  newChatAutoExpireSchema,
  sidebarPinsSchema,
} from '@pulpo/contracts'

export function preferencesWithModelDefaults(values?: Record<string, unknown>): Record<string, unknown> {
  const parsedAnimationSpeed = animationSpeedSchema.safeParse(values?.animationSpeed)
  const parsedAutomaticChatExpiration = automaticChatExpirationSchema.safeParse(values?.automaticChatExpiration)
  const parsedNewChatAutoExpire = newChatAutoExpireSchema.safeParse(values?.newChatAutoExpire)
  const parsedChatSortMode = chatSortModeSchema.safeParse(values?.chatSortMode)
  const parsedFileDoubleClickAction = fileDoubleClickActionSchema.safeParse(values?.fileDoubleClickAction)
  const parsedAgentModes = agentModesSchema.safeParse(values?.agentModes)
  const parsedInstructionPresetSelections = instructionPresetSelectionsSchema.safeParse(values?.instructionPresetSelections)
  const parsedModelWarningDismissals = modelWarningDismissalsSchema.safeParse(values?.modelWarningDismissals)
  const modelPreferences = modelPreferencesSchema.parse({
    favoriteModelIds: Array.isArray(values?.favoriteModelIds) ? values.favoriteModelIds : undefined,
    providerOrder: values?.providerOrder,
  })
  return {
    ...values,
    imageGeneration: imageGenerationPreferencesSchema.catch({ enabled: false, modelId: null }).parse(values?.imageGeneration),
    speech: speechPreferencesSchema.catch({ modelId: null, models: {} }).parse(values?.speech),
    animationSpeed: parsedAnimationSpeed.success ? parsedAnimationSpeed.data : animationSpeedSchema.parse(undefined),
    automaticChatExpiration: parsedAutomaticChatExpiration.success ? parsedAutomaticChatExpiration.data : '24h',
    newChatAutoExpire: parsedNewChatAutoExpire.success ? parsedNewChatAutoExpire.data : false,
    chatSortMode: parsedChatSortMode.success ? parsedChatSortMode.data : 'default',
    fileDoubleClickAction: parsedFileDoubleClickAction.success ? parsedFileDoubleClickAction.data : 'open',
    sidebarPins: sidebarPinsSchema.parse(values?.sidebarPins ?? {}),
    agentModes: parsedAgentModes.success ? parsedAgentModes.data : {},
    instructionPresetSelections: parsedInstructionPresetSelections.success ? parsedInstructionPresetSelections.data : {},
    modelWarningDismissals: parsedModelWarningDismissals.success ? parsedModelWarningDismissals.data : {},
    // Unset model choices stay null so they follow the current new-account defaults.
    defaultModelId: typeof values?.defaultModelId === 'string' && values.defaultModelId ? values.defaultModelId : null,
    favoriteModelIds: Array.isArray(values?.favoriteModelIds) ? modelPreferences.favoriteModelIds : null,
    providerOrder: modelPreferences.providerOrder,
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
  const modelWarningDismissals = 'modelWarningDismissals' in patch
    ? modelWarningDismissalsSchema.parse(patch.modelWarningDismissals)
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
    ...(modelWarningDismissals === undefined ? {} : { modelWarningDismissals }),
  }
}
