import { Platform } from 'react-native'
import { Button, Host, HStack, Image, Menu, Picker, Section, Spacer, Text } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonStyle, disabled, foregroundStyle, frame, lineLimit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import { MaterialMenu } from '../../platform/MaterialUI'

type SpeechPickerProps = {
  label: string
  value?: string
  placeholder: string
  options: readonly { id: string; label: string; previewAvailable?: boolean }[]
  onChange: (id: string) => void
  onPreview?: (id: string) => void
}

export function SpeechPicker({ label, value, placeholder, options, onChange, onPreview }: SpeechPickerProps) {
  const selected = options.find(option => option.id === value)
  const text = selected?.label ?? placeholder
  const previews = onPreview ? options.filter(option => option.previewAvailable) : []
  if (Platform.OS === 'ios') return <Host ignoreSafeArea="keyboard" style={{ height: 48, width: '100%' }}>
    <Menu label={<HStack spacing={8} modifiers={[frame({ maxWidth: Infinity, minHeight: 44 })]}>
      <Text modifiers={[lineLimit(1)]}>{text}</Text><Spacer />
      <Image systemName="chevron.up.chevron.down" size={12} modifiers={[foregroundStyle('secondary')]} />
    </HStack>} modifiers={[buttonStyle('bordered'), foregroundStyle('primary'), accessibilityLabel(`${label}: ${text}`), disabled(options.length === 0)]}>
      <Picker label={label} selection={selected?.id ?? ''} onSelectionChange={id => { if (options.some(option => option.id === id)) onChange(id) }} modifiers={[pickerStyle('inline')]}>
        {!selected && <Text modifiers={[tag(''), disabled()]}>{placeholder}</Text>}
        {options.map(option => <Text key={option.id} modifiers={[tag(option.id)]}>{option.label}</Text>)}
      </Picker>
      {previews.length > 0 && <Section title="Preview voices">
        {previews.map(option => <Button key={option.id} label={`Preview ${option.label}`} systemImage="play.fill" onPress={() => onPreview?.(option.id)} />)}
      </Section>}
    </Menu>
  </Host>
  return <MaterialMenu label={`${label}: ${text}`} icon="chevron.down" text={text} disabled={options.length === 0} sections={[
    { id: 'choices', actions: options.map(option => ({ id: option.id, label: option.label, selected: option.id === value, onPress: () => onChange(option.id) })) },
    ...(previews.length ? [{ id: 'previews', title: 'Preview voices', actions: previews.map(option => ({ id: option.id, label: `Preview ${option.label}`, icon: 'play.fill', onPress: () => onPreview?.(option.id) })) }] : []),
  ]} />
}
