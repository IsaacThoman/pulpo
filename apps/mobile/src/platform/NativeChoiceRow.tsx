import { HStack, Image, Menu, Spacer, Text } from '@expo/ui/swift-ui'
import { buttonStyle, foregroundStyle, frame } from '@expo/ui/swift-ui/modifiers'
import { NativeMenuPicker } from './NativeMenuPicker'

/** A SwiftUI Form row that shows the chosen value and opens the choices in a menu. */
export function NativeChoiceRow<T extends string>({ title, value, options, onChange, icon }: { title: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; icon?: string }) {
  const selected = options.find((option) => option.value === value)?.label ?? value
  return <Menu label={<HStack spacing={12}>{icon ? <Image systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} /> : null}<Text>{title}</Text><Spacer /><Text modifiers={[foregroundStyle('secondary')]}>{selected}</Text><Image systemName="chevron.up.chevron.down" size={10} modifiers={[foregroundStyle('secondary')]} /></HStack>} modifiers={[buttonStyle('plain'), foregroundStyle('primary')]}><NativeMenuPicker label={title} selection={value} options={options.map((option) => ({ id: option.value, label: option.label }))} onSelect={(id) => onChange(id as T)} /></Menu>
}
