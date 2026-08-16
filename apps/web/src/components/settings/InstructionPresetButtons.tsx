import type { InstructionPreset } from '@pulpo/contracts'
import { instructionPresetEnabled } from './instruction-preset-buttons-logic'

function contrastingTextColor(hex: string): '#111827' | '#ffffff' {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255
  const linear = (channel: number) => channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
  const luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  return luminance > 0.42 ? '#111827' : '#ffffff'
}

export function InstructionPresetButtons({
  presets,
  selections,
  onToggle,
}: {
  presets: InstructionPreset[]
  selections: Record<string, boolean>
  onToggle: (presetId: string, enabled: boolean) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((preset) => {
        const enabled = instructionPresetEnabled(preset, selections)
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={enabled}
            onClick={() => onToggle(preset.id, !enabled)}
            className="cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={enabled
              ? {
                  backgroundColor: preset.color,
                  borderColor: preset.color,
                  color: contrastingTextColor(preset.color),
                  boxShadow: `0 0 0 1px ${preset.color}33`,
                }
              : {
                  backgroundColor: 'var(--muted)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted-foreground)',
                }}
          >
            {preset.title}
          </button>
        )
      })}
    </div>
  )
}
