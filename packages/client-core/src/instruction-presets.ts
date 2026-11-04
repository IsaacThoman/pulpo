import type { InstructionPreset } from '@pulpo/contracts'

/** Whether a preset applies: the account's explicit choice, else the admin's default. */
export function instructionPresetEnabled(
  preset: Pick<InstructionPreset, 'id' | 'defaultEnabled'>,
  selections: Record<string, boolean>,
): boolean {
  return selections[preset.id] ?? preset.defaultEnabled
}
