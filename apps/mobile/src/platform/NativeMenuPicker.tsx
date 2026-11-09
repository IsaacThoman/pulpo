import type { ComponentProps, ReactElement } from 'react'
import { Label, Picker, Text } from '@expo/ui/swift-ui'
import { labelsHidden, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'

/**
 * `icon` must be a native element such as an SF Symbol `Image`. A bare string would render as raw
 * text inside the Label's native slot, which crashes a Release build on its first render.
 */
export type NativeMenuPickerOption = { id: string; label: string; icon?: ReactElement }

/**
 * The choices inside a SwiftUI menu, as an inline Picker: iOS draws the checkmark beside the
 * selected choice and VoiceOver reports it as selected. Buttons with a checkmark image (or a custom
 * row holding one) lose both inside a menu, and a Toggle with a custom label is left out of it.
 */
export function NativeMenuPicker({ label, selection, options, onSelect, modifiers }: {
  /** Names the choices for screen readers; the enclosing section shows any visible title. */
  label: string
  selection: string | undefined
  options: readonly NativeMenuPickerOption[]
  onSelect: (id: string) => void
  modifiers?: ComponentProps<typeof Picker>['modifiers']
}) {
  return (
    <Picker
      label={label}
      selection={selection}
      onSelectionChange={(next) => { if (typeof next === 'string') onSelect(next) }}
      modifiers={[pickerStyle('inline'), labelsHidden(), ...(modifiers ?? [])]}
    >
      {options.map((option) => option.icon
        ? <Label key={option.id} title={option.label} icon={option.icon} modifiers={[tag(option.id)]} />
        : <Text key={option.id} modifiers={[tag(option.id)]}>{option.label}</Text>)}
    </Picker>
  )
}
