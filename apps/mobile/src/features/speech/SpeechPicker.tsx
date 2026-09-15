import { Platform } from 'react-native'
import { HStack, Image, Menu, Picker, Spacer, Text } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonStyle, disabled, foregroundStyle, lineLimit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import { MaterialMenu } from '../../platform/MaterialUI'

type SpeechPickerProps = {
  label: string
  value?: string
  placeholder: string
  options: readonly { id: string; label: string }[]
  onChange: (id: string) => void
}

export function SpeechPicker({ label, value, placeholder, options, onChange }: SpeechPickerProps) {
  const selected = options.find(option => option.id === value)
  const text = selected?.label ?? placeholder
  if (Platform.OS === 'ios') return <Menu label={<HStack spacing={12}>
      <Text>{label}</Text><Spacer /><Text modifiers={[foregroundStyle('secondary'), lineLimit(1)]}>{text}</Text>
      <Image systemName="chevron.up.chevron.down" size={12} modifiers={[foregroundStyle('secondary')]} />
    </HStack>} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), accessibilityLabel(`${label}: ${text}`), disabled(options.length === 0)]}>
      <Picker label={label} selection={selected?.id ?? ''} onSelectionChange={id => { if (options.some(option => option.id === id)) onChange(id) }} modifiers={[pickerStyle('inline')]}>
        {!selected && <Text modifiers={[tag(''), disabled()]}>{placeholder}</Text>}
        {options.map(option => <Text key={option.id} modifiers={[tag(option.id)]}>{option.label}</Text>)}
      </Picker>
    </Menu>
  return <MaterialMenu label={`${label}: ${text}`} icon="chevron.down" text={text} disabled={options.length === 0} sections={[
    { id: 'choices', actions: options.map(option => ({ id: option.id, label: option.label, selected: option.id === value, onPress: () => onChange(option.id) })) },
  ]} />
}
