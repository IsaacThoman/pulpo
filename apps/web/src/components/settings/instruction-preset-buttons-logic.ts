import type { InstructionPreset } from '@pulpo/contracts'

export function instructionPresetEnabled(
  preset: InstructionPreset,
  selections: Record<string, boolean>,
): boolean {
  return selections[preset.id] ?? preset.defaultEnabled
}
